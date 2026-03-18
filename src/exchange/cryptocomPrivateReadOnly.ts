import { signPrivateRequest } from "./cryptocomTrading";

type ReadOnlyClientOptions = {
  apiKey: string;
  apiSecret: string;
  apiBaseUrl: string;
};

type PrivateResponse<TResult> = {
  code?: number;
  message?: string;
  result?: TResult;
};

type RawBalance = {
  currency?: unknown;
  balance?: unknown;
  available?: unknown;
  reserved?: unknown;
};

type VisibleBalance = {
  asset: string;
  available: string;
  total: string;
  reserved?: string;
};

function toDecimalString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim().length > 0 ? value.trim() : "0";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "0";
}

function toStringId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function parseBalances(result: unknown): VisibleBalance[] {
  const accounts = (result as { accounts?: unknown })?.accounts;
  if (!Array.isArray(accounts)) {
    return [];
  }
  return accounts
    .map((row) => row as RawBalance)
    .map((row) => ({
      asset: String(row.currency ?? "").trim(),
      available: toDecimalString(row.available),
      total: toDecimalString(row.balance),
      reserved: row.reserved === undefined ? undefined : toDecimalString(row.reserved)
    }))
    .filter((row) => row.asset.length > 0);
}

export function parseOpenOrders(result: unknown): unknown[] {
  const candidate = result as { order_list?: unknown; orderList?: unknown; data?: unknown };
  if (Array.isArray(candidate.order_list)) {
    return candidate.order_list;
  }
  if (Array.isArray(candidate.orderList)) {
    return candidate.orderList;
  }
  if (Array.isArray(candidate.data)) {
    return candidate.data;
  }
  return [];
}

export function parseTradeHistory(result: unknown): unknown[] {
  const candidate = result as { trade_list?: unknown; tradeList?: unknown; data?: unknown; order_list?: unknown };
  if (Array.isArray(candidate.trade_list)) {
    return candidate.trade_list;
  }
  if (Array.isArray(candidate.tradeList)) {
    return candidate.tradeList;
  }
  if (Array.isArray(candidate.data)) {
    return candidate.data;
  }
  if (Array.isArray(candidate.order_list)) {
    return candidate.order_list;
  }
  return [];
}

async function resolveFetch(): Promise<typeof fetch> {
  if (typeof globalThis.fetch === "function") {
    return globalThis.fetch.bind(globalThis);
  }
  const undici = await import("undici");
  return undici.fetch as unknown as typeof fetch;
}

export class CryptoComPrivateReadOnlyClient {
  constructor(private readonly options: ReadOnlyClientOptions) {}

  private async postPrivate<TResult>(method: string, params: Record<string, unknown> = {}): Promise<TResult> {
    const fetchFn = await resolveFetch();
    const id = toStringId(Date.now()) ?? "0";
    const nonce = toStringId(Date.now()) ?? "0";
    const numericId = Number(id);
    const numericNonce = Number(nonce);

    const response = await fetchFn(`${this.options.apiBaseUrl}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id,
        method,
        api_key: this.options.apiKey,
        params,
        nonce,
        sig: signPrivateRequest({
          method,
          id: numericId,
          apiKey: this.options.apiKey,
          params,
          nonce: numericNonce,
          apiSecret: this.options.apiSecret
        })
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const body = (await response.json()) as PrivateResponse<TResult>;
    if (body.code !== 0) {
      throw new Error(body.message ?? `Crypto.com private API code ${String(body.code ?? "unknown")}`);
    }
    if (body.result === undefined) {
      throw new Error("Missing result");
    }
    return body.result;
  }

  public async getBalances(): Promise<VisibleBalance[]> {
    const result = await this.postPrivate("private/user-balance");
    return parseBalances(result);
  }

  public async getOpenOrders(instrumentName?: string): Promise<unknown[]> {
    const result = await this.postPrivate("private/get-open-orders", {
      ...(instrumentName ? { instrument_name: instrumentName } : {})
    });
    return parseOpenOrders(result);
  }

  public async getTradeHistory(instrumentName?: string): Promise<unknown[]> {
    try {
      const result = await this.postPrivate("private/get-trades", {
        ...(instrumentName ? { instrument_name: instrumentName } : {})
      });
      return parseTradeHistory(result);
    } catch {
      const result = await this.postPrivate("private/get-order-history", {
        ...(instrumentName ? { instrument_name: instrumentName } : {})
      });
      return parseTradeHistory(result);
    }
  }
}
