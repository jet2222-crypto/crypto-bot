import { createHmac } from "node:crypto";

type PrivateApiEnvelope<TParams> = {
  id: number;
  method: string;
  api_key: string;
  params: TParams;
  nonce: number;
  sig: string;
};

type PrivateApiResponse<TResult> = {
  id?: number;
  method?: string;
  code?: number;
  message?: string;
  result?: TResult;
};

type TradingClientOptions = {
  apiKey: string;
  apiSecret: string;
  apiBaseUrl?: string;
};

export type CryptoComBalance = {
  currency?: string;
  balance?: number | string;
  available?: number | string;
  reserved?: number | string;
};

export type CryptoComNormalizedOrderStatus = {
  status:
    | "SUBMITTED_PENDING_CONFIRMATION"
    | "OPEN"
    | "ACTIVE_PARTIALLY_FILLED"
    | "FILLED"
    | "CANCELLED"
    | "REJECTED"
    | "UNKNOWN";
  exchangeStatus?: string;
  cumulativeQuantity?: string;
  confirmedByExchange: boolean;
  pendingConfirmation: boolean;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function toPositiveNumber(value: unknown): number {
  const raw = toStringValue(value);
  if (!raw) {
    return 0;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function serializeParamsForSignature(value: unknown, level = 0): string {
  if (level >= 3) {
    return String(value);
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeParamsForSignature(item, level + 1)).join("");
  }
  if (isObject(value)) {
    return Object.keys(value)
      .sort()
      .map((key) => `${key}${serializeParamsForSignature(value[key], level + 1)}`)
      .join("");
  }
  return String(value);
}

export function signPrivateRequest(input: {
  method: string;
  id: number;
  apiKey: string;
  params: Record<string, unknown>;
  nonce: number;
  apiSecret: string;
}): string {
  const payload = `${input.method}${input.id}${input.apiKey}${serializeParamsForSignature(input.params)}${input.nonce}`;
  return createHmac("sha256", input.apiSecret).update(payload).digest("hex");
}

// REST submission only confirms acceptance of the request envelope.
// Actual order lifecycle truth should later come from exchange order-detail
// polling or, preferably, authenticated WebSocket execution events.
export function normalizeCryptoComOrderStatus(detail: unknown): CryptoComNormalizedOrderStatus {
  const record = isObject(detail) ? detail : {};
  const exchangeStatus = toStringValue(record.status) ?? toStringValue(record.order_status);
  const upper = exchangeStatus?.toUpperCase();
  const cumulativeQuantity =
    toStringValue(record.cumulative_quantity) ??
    toStringValue(record.cumulativeQuantity) ??
    toStringValue(record.executed_quantity) ??
    toStringValue(record.exec_qty);
  const filled = toPositiveNumber(cumulativeQuantity);

  if (!upper) {
    return {
      status: "UNKNOWN",
      exchangeStatus,
      cumulativeQuantity,
      confirmedByExchange: false,
      pendingConfirmation: false
    };
  }
  if (upper.includes("PARTIALLY_FILLED") || ((upper === "ACTIVE" || upper === "OPEN") && filled > 0)) {
    return {
      status: "ACTIVE_PARTIALLY_FILLED",
      exchangeStatus,
      cumulativeQuantity,
      confirmedByExchange: true,
      pendingConfirmation: false
    };
  }
  if (upper.includes("FILLED")) {
    return {
      status: "FILLED",
      exchangeStatus,
      cumulativeQuantity,
      confirmedByExchange: true,
      pendingConfirmation: false
    };
  }
  if (upper.includes("CANCEL")) {
    return {
      status: "CANCELLED",
      exchangeStatus,
      cumulativeQuantity,
      confirmedByExchange: true,
      pendingConfirmation: false
    };
  }
  if (upper.includes("REJECT") || upper.includes("EXPIRE")) {
    return {
      status: "REJECTED",
      exchangeStatus,
      cumulativeQuantity,
      confirmedByExchange: true,
      pendingConfirmation: false
    };
  }
  if (upper === "ACTIVE" || upper === "OPEN" || upper === "NEW" || upper === "PENDING") {
    return {
      status: "OPEN",
      exchangeStatus,
      cumulativeQuantity,
      confirmedByExchange: true,
      pendingConfirmation: false
    };
  }
  return {
    status: "UNKNOWN",
    exchangeStatus,
    cumulativeQuantity,
    confirmedByExchange: true,
    pendingConfirmation: false
  };
}

async function resolveFetch(): Promise<typeof fetch> {
  if (typeof globalThis.fetch === "function") {
    return globalThis.fetch.bind(globalThis);
  }
  const undici = await import("undici");
  return undici.fetch as unknown as typeof fetch;
}

export class CryptoComTradingClient {
  private readonly apiBaseUrl: string;

  constructor(private readonly options: TradingClientOptions) {
    this.apiBaseUrl = options.apiBaseUrl ?? "https://api.crypto.com/exchange/v1";
  }

  public async postPrivate<TResult>(method: string, params: Record<string, unknown> = {}): Promise<TResult> {
    const fetchFn = await resolveFetch();
    const id = Date.now();
    const nonce = Date.now();
    const payload: PrivateApiEnvelope<Record<string, unknown>> = {
      id,
      method,
      api_key: this.options.apiKey,
      params,
      nonce,
      sig: signPrivateRequest({
        method,
        id,
        apiKey: this.options.apiKey,
        params,
        nonce,
        apiSecret: this.options.apiSecret
      })
    };

    const response = await fetchFn(`${this.apiBaseUrl}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Crypto.com trading request failed: HTTP ${response.status}`);
    }

    const body = (await response.json()) as PrivateApiResponse<TResult>;
    if (body.code !== 0) {
      throw new Error(`Crypto.com trading API ${method} failed: ${body.message ?? body.code ?? "unknown error"}`);
    }
    if (body.result === undefined) {
      throw new Error(`Crypto.com trading API ${method} returned no result`);
    }
    return body.result;
  }

  public async getBalances(): Promise<CryptoComBalance[]> {
    const result = await this.postPrivate<{ accounts?: CryptoComBalance[] }>("private/user-balance");
    return result.accounts ?? [];
  }

  public async getAccountSummary(): Promise<unknown> {
    return this.postPrivate("private/user-balance");
  }

  public async getOpenOrders(instrumentName?: string): Promise<unknown[]> {
    const result = await this.postPrivate<{ order_list?: unknown[] }>("private/get-open-orders", {
      ...(instrumentName ? { instrument_name: instrumentName } : {})
    });
    return result.order_list ?? [];
  }

  public async getOrderDetail(orderId: string): Promise<unknown> {
    return this.postPrivate("private/get-order-detail", { order_id: orderId });
  }

  public async createOrder(input: {
    instrumentName: string;
    side: "BUY" | "SELL";
    type: "MARKET" | "LIMIT";
    quantity: number;
    price?: number;
    clientOrderId?: string;
  }): Promise<unknown> {
    return this.postPrivate("private/create-order", {
      instrument_name: input.instrumentName,
      side: input.side,
      type: input.type,
      quantity: input.quantity.toString(),
      ...(typeof input.price === "number" ? { price: input.price.toString() } : {}),
      ...(input.clientOrderId ? { client_oid: input.clientOrderId } : {})
    });
  }

  public async cancelOrder(orderId: string): Promise<unknown> {
    return this.postPrivate("private/cancel-order", { order_id: orderId });
  }
}
