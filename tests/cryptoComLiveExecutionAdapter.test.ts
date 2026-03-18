import { describe, expect, it, vi } from "vitest";
import { CryptoComLiveExecutionAdapter } from "../src/execution/cryptoComLiveExecutionAdapter";

describe("Crypto.com live execution adapter safety", () => {
  it("does not send live requests in dry-run mode", async () => {
    const createOrder = vi.fn(async () => ({ order_id: "123", status: "ACTIVE" }));
    const adapter = new CryptoComLiveExecutionAdapter({
      apiKey: "key",
      apiSecret: "secret",
      dryRun: true,
      client: {
        createOrder,
        cancelOrder: vi.fn(async () => ({})),
        getBalances: vi.fn(async () => []),
        getOpenOrders: vi.fn(async () => []),
        getOrderDetail: vi.fn(async () => ({}))
      }
    });

    const result = await adapter.placeEntry({
      instrument: "BTC_USDT",
      side: "BUY",
      type: "MARKET",
      quantity: 0.01
    });

    expect(createOrder).not.toHaveBeenCalled();
    expect(result.status).toBe("DRY_RUN_SIMULATED");
    expect(result.submissionState).toBe("DRY_RUN_NOT_SENT");
    expect(result.confirmedByExchange).toBe(false);
    expect(result.dryRun).toBe(true);
  });

  it("does not overstate REST submission as exchange confirmed", async () => {
    const adapter = new CryptoComLiveExecutionAdapter({
      apiKey: "key",
      apiSecret: "secret",
      dryRun: false,
      client: {
        createOrder: vi.fn(async () => ({ order_id: "123", client_oid: "cid-1", status: "ACTIVE" })),
        cancelOrder: vi.fn(async () => ({})),
        getBalances: vi.fn(async () => []),
        getOpenOrders: vi.fn(async () => []),
        getOrderDetail: vi.fn(async () => ({}))
      }
    });

    const result = await adapter.placeEntry({
      instrument: "BTC_USDT",
      side: "BUY",
      type: "MARKET",
      quantity: 0.01,
      clientOrderId: "cid-1"
    });

    expect(result.status).toBe("SUBMITTED_PENDING_CONFIRMATION");
    expect(result.submissionState).toBe("SUBMITTED_PENDING_CONFIRMATION");
    expect(result.confirmedByExchange).toBe(false);
    expect(result.pendingConfirmation).toBe(true);
    expect(result.exchangeStatus).toBe("ACTIVE");
  });
});
