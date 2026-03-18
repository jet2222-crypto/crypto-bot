import { describe, expect, it } from "vitest";
import {
  normalizeCryptoComOrderStatus,
  serializeParamsForSignature,
  signPrivateRequest
} from "../src/exchange/cryptocomTrading";

describe("Crypto.com trading signing", () => {
  it("serializes params deterministically with sorted keys", () => {
    const serialized = serializeParamsForSignature({
      b: 2,
      a: {
        z: "last",
        c: "first"
      }
    });

    expect(serialized).toBe("acfirstzlastb2");
  });

  it("matches the expected HMAC signature for a known payload", () => {
    const sig = signPrivateRequest({
      method: "private/get-order-detail",
      id: 11,
      apiKey: "token",
      params: {
        order_id: "53287421324"
      },
      nonce: 1589594102779,
      apiSecret: "secretKey"
    });

    expect(sig).toBe("2fde7f9de2830ca3246cec46bb7e65cf7a99a797da19108f0e44cf145d7e0a33");
  });

  it("interprets partial fills as active with cumulative quantity", () => {
    const normalized = normalizeCryptoComOrderStatus({
      status: "ACTIVE",
      cumulative_quantity: "0.125"
    });

    expect(normalized.status).toBe("ACTIVE_PARTIALLY_FILLED");
    expect(normalized.confirmedByExchange).toBe(true);
    expect(normalized.pendingConfirmation).toBe(false);
  });
});
