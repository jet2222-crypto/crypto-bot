import { describe, expect, it } from "vitest";
import {
  redactSensitiveText,
  runCryptoComAuthProbe,
  runCryptoComReadOnlyProbe
} from "../src/diagnostics/cryptocomProbe";
import { parseOpenOrders, parseTradeHistory } from "../src/exchange/cryptocomPrivateReadOnly";

describe("Crypto.com read-only auth probe", () => {
  it("returns missing-credential state for minimal auth probe", async () => {
    const result = await runCryptoComAuthProbe({});

    expect(result.authConfigured).toBe(false);
    expect(result.authSucceeded).toBe(false);
    expect(result.endpointUsed).toBe("private/user-balance");
  });

  it("handles invalid credentials for minimal auth probe", async () => {
    const result = await runCryptoComAuthProbe({
      apiKey: "key",
      apiSecret: "secret",
      clientFactory: () => ({
        getBalances: async () => {
          throw new Error("invalid api key secret");
        }
      })
    });

    expect(result.authConfigured).toBe(true);
    expect(result.authSucceeded).toBe(false);
    expect(result.accountSummaryAvailable).toBe(false);
    expect(result.readableMessage).not.toContain("secret");
  });

  it("handles successful signed request probe", async () => {
    const result = await runCryptoComAuthProbe({
      apiKey: "key",
      apiSecret: "secret",
      clientFactory: () => ({
        getBalances: async () => [{ asset: "USDT", available: "1200.00", total: "1300.00", reserved: "100.00" }]
      })
    });

    expect(result.authConfigured).toBe(true);
    expect(result.authSucceeded).toBe(true);
    expect(result.accountSummaryAvailable).toBe(true);
    expect(result.endpointUsed).toBe("private/user-balance");
    expect(result.visibleBalanceCount).toBe(1);
    expect(result.allBalancesZero).toBe(false);
    expect(result.quoteBalanceUsdOrUsdt).toBe("1300.00");
  });

  it("handles missing credentials safely", async () => {
    const diagnostics = await runCryptoComReadOnlyProbe({});

    expect(diagnostics.cryptoComAuthConfigured).toBe(false);
    expect(diagnostics.cryptoComAuthHealthy).toBe(false);
    expect(diagnostics.cryptoComConnectionMessage).toContain("not configured");
  });

  it("handles invalid credentials without throwing", async () => {
    const diagnostics = await runCryptoComReadOnlyProbe({
      apiKey: "key",
      apiSecret: "secret",
      clientFactory: () => ({
        getBalances: async () => {
          throw new Error("invalid api key secret");
        },
        getOpenOrders: async () => {
          throw new Error("permission denied");
        },
        getTradeHistory: async () => {
          throw new Error("signature rejected");
        }
      })
    });

    expect(diagnostics.cryptoComAuthConfigured).toBe(true);
    expect(diagnostics.cryptoComAuthHealthy).toBe(false);
    expect(diagnostics.warnings).toEqual(
      expect.arrayContaining(["invalid credentials or signature rejected", "permission-limited endpoint"])
    );
  });

  it("supports partial capability availability", async () => {
    const diagnostics = await runCryptoComReadOnlyProbe({
      apiKey: "key",
      apiSecret: "secret",
      clientFactory: () => ({
        getBalances: async () => [{ asset: "USDT", available: "1200.00", total: "1300.00", reserved: "100.00" }],
        getOpenOrders: async () => {
          throw new Error("permission denied");
        },
        getTradeHistory: async () => []
      })
    });

    expect(diagnostics.cryptoComAuthHealthy).toBe(true);
    expect(diagnostics.cryptoComAccountSummaryAvailable).toBe(true);
    expect(diagnostics.cryptoComOpenOrdersAvailable).toBe(false);
    expect(diagnostics.cryptoComTradeHistoryAvailable).toBe(true);
    expect(diagnostics.visibleBalances[0].asset).toBe("USDT");
    expect(diagnostics.visibleBalanceCount).toBe(1);
    expect(diagnostics.allBalancesZero).toBe(false);
    expect(diagnostics.quoteBalanceUsdOrUsdt).toBe("1300.00");
  });

  it("treats zero balances as successful authenticated reads", async () => {
    const result = await runCryptoComAuthProbe({
      apiKey: "key",
      apiSecret: "secret",
      clientFactory: () => ({
        getBalances: async () => [
          { asset: "USDT", available: "0", total: "0", reserved: "0" },
          { asset: "BTC", available: "0.0000", total: "0.0000" }
        ]
      })
    });

    expect(result.authSucceeded).toBe(true);
    expect(result.accountSummaryAvailable).toBe(true);
    expect(result.visibleBalanceCount).toBe(2);
    expect(result.allBalancesZero).toBe(true);
    expect(result.quoteBalanceUsdOrUsdt).toBe("0");
  });

  it("handles missing balance payload as empty but successful", async () => {
    const result = await runCryptoComAuthProbe({
      apiKey: "key",
      apiSecret: "secret",
      clientFactory: () => ({
        getBalances: async () => []
      })
    });

    expect(result.authSucceeded).toBe(true);
    expect(result.visibleBalances).toEqual([]);
    expect(result.visibleBalanceCount).toBe(0);
    expect(result.allBalancesZero).toBe(true);
  });

  it("parses endpoint-specific shapes", () => {
    expect(parseOpenOrders({ order_list: [{ order_id: "1" }] })).toHaveLength(1);
    expect(parseOpenOrders({ data: [{ order_id: "2" }] })).toHaveLength(1);
    expect(parseTradeHistory({ trade_list: [{ trade_id: "1" }] })).toHaveLength(1);
    expect(parseTradeHistory({ order_list: [{ order_id: "9" }] })).toHaveLength(1);
  });

  it("redacts secrets from diagnostic text", () => {
    const redacted = redactSensitiveText("failed for key secret token", ["key", "secret"]);
    expect(redacted).not.toContain("key");
    expect(redacted).not.toContain("secret");
    expect(redacted).toContain("[REDACTED]");
  });
});
