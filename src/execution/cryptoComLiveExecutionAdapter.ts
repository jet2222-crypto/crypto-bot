import { CryptoComTradingClient, CryptoComBalance, normalizeCryptoComOrderStatus } from "../exchange/cryptocomTrading";
import { BalanceSnapshot, ClosePositionRequest, EntryOrderRequest, ExecutionAdapter, OrderResult } from "./types";

type LiveAdapterOptions = {
  apiKey: string;
  apiSecret: string;
  apiBaseUrl?: string;
  dryRun?: boolean;
  client?: Pick<CryptoComTradingClient, "createOrder" | "cancelOrder" | "getBalances" | "getOpenOrders" | "getOrderDetail">;
};

export class CryptoComLiveExecutionAdapter implements ExecutionAdapter {
  public readonly mode = "live" as const;
  public readonly liveTradingEnabled = true;
  public readonly liveExecutionDryRun: boolean;
  private readonly client: Pick<CryptoComTradingClient, "createOrder" | "cancelOrder" | "getBalances" | "getOpenOrders" | "getOrderDetail">;

  constructor(options: LiveAdapterOptions) {
    this.liveExecutionDryRun = options.dryRun ?? true;
    this.client =
      options.client ??
      new CryptoComTradingClient({
        apiKey: options.apiKey,
        apiSecret: options.apiSecret,
        apiBaseUrl: options.apiBaseUrl
      });
  }

  private buildDryRunResult(
    action: "ENTRY" | "CLOSE" | "CANCEL",
    input: {
      instrument?: string;
      side?: "BUY" | "SELL";
      quantity?: number;
      type?: "MARKET" | "LIMIT";
      price?: number;
      clientOrderId?: string;
      orderId?: string;
    }
  ): OrderResult {
    const summary = `${action} dry-run only: no request sent to Crypto.com`;
    return {
      orderId: input.orderId,
      clientOrderId: input.clientOrderId,
      status: "DRY_RUN_SIMULATED",
      submissionState: "DRY_RUN_NOT_SENT",
      confirmedByExchange: false,
      pendingConfirmation: false,
      dryRun: true,
      summary,
      raw: {
        action,
        ...input
      }
    };
  }

  public async placeEntry(request: EntryOrderRequest): Promise<OrderResult> {
    if (this.liveExecutionDryRun) {
      return this.buildDryRunResult("ENTRY", request);
    }
    const result = await this.client.createOrder({
      instrumentName: request.instrument,
      side: request.side,
      type: request.type,
      quantity: request.quantity,
      price: request.price,
      clientOrderId: request.clientOrderId
    });
    const raw = result as { order_id?: string; client_oid?: string; status?: string };
    return {
      orderId: raw.order_id,
      clientOrderId: raw.client_oid,
      status: "SUBMITTED_PENDING_CONFIRMATION",
      submissionState: "SUBMITTED_PENDING_CONFIRMATION",
      confirmedByExchange: false,
      pendingConfirmation: true,
      dryRun: false,
      exchangeStatus: raw.status,
      summary: "Order submitted via REST; awaiting exchange confirmation",
      raw: result
    };
  }

  public async closePosition(request: ClosePositionRequest): Promise<OrderResult> {
    if (this.liveExecutionDryRun) {
      return this.buildDryRunResult("CLOSE", {
        instrument: request.instrument,
        quantity: request.quantity,
        type: request.type,
        price: request.price,
        clientOrderId: request.clientOrderId
      });
    }
    const result = await this.client.createOrder({
      instrumentName: request.instrument,
      side: "SELL",
      type: request.type,
      quantity: request.quantity,
      price: request.price,
      clientOrderId: request.clientOrderId
    });
    const raw = result as { order_id?: string; client_oid?: string; status?: string };
    return {
      orderId: raw.order_id,
      clientOrderId: raw.client_oid,
      status: "SUBMITTED_PENDING_CONFIRMATION",
      submissionState: "SUBMITTED_PENDING_CONFIRMATION",
      confirmedByExchange: false,
      pendingConfirmation: true,
      dryRun: false,
      exchangeStatus: raw.status,
      summary: "Close order submitted via REST; awaiting exchange confirmation",
      raw: result
    };
  }

  public async cancelOrder(orderId: string): Promise<OrderResult> {
    if (this.liveExecutionDryRun) {
      return this.buildDryRunResult("CANCEL", { orderId });
    }
    const result = await this.client.cancelOrder(orderId);
    const raw = result as { order_id?: string; status?: string };
    return {
      orderId: raw.order_id ?? orderId,
      status: "SUBMITTED_PENDING_CONFIRMATION",
      submissionState: "SUBMITTED_PENDING_CONFIRMATION",
      confirmedByExchange: false,
      pendingConfirmation: true,
      dryRun: false,
      exchangeStatus: raw.status,
      summary: "Cancel request submitted via REST; awaiting exchange confirmation",
      raw: result
    };
  }

  public async getBalances(): Promise<BalanceSnapshot[]> {
    const balances = await this.client.getBalances();
    return balances.map((balance: CryptoComBalance) => ({
      currency: balance.currency ?? "",
      available: typeof balance.available === "string" ? balance.available : String(balance.available ?? "0"),
      total: typeof balance.balance === "string" ? balance.balance : String(balance.balance ?? "0"),
      reserved: typeof balance.reserved === "string" ? balance.reserved : balance.reserved === undefined ? undefined : String(balance.reserved)
    }));
  }

  public async getOpenOrders(instrument?: string): Promise<unknown[]> {
    return this.client.getOpenOrders(instrument);
  }

  public async getOrderStatus(orderId: string): Promise<unknown> {
    const detail = await this.client.getOrderDetail(orderId);
    return {
      ...normalizeCryptoComOrderStatus(detail),
      raw: detail
    };
  }
}
