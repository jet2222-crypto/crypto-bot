export type ExecutionMode = "paper" | "live";
export type SubmissionState = "PAPER_NOOP" | "DRY_RUN_NOT_SENT" | "SUBMITTED_PENDING_CONFIRMATION" | "EXCHANGE_CONFIRMED";
export type NormalizedExecutionStatus =
  | "PAPER_NOOP"
  | "DRY_RUN_SIMULATED"
  | "SUBMITTED_PENDING_CONFIRMATION"
  | "OPEN"
  | "ACTIVE_PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELLED"
  | "REJECTED"
  | "UNKNOWN";

export type EntryOrderRequest = {
  instrument: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  quantity: number;
  price?: number;
  clientOrderId?: string;
};

export type ClosePositionRequest = {
  instrument: string;
  quantity: number;
  type: "MARKET" | "LIMIT";
  price?: number;
  clientOrderId?: string;
};

export type OrderResult = {
  orderId?: string;
  clientOrderId?: string;
  status: NormalizedExecutionStatus;
  submissionState: SubmissionState;
  confirmedByExchange: boolean;
  pendingConfirmation: boolean;
  dryRun: boolean;
  exchangeStatus?: string;
  summary?: string;
  raw?: unknown;
};

export type BalanceSnapshot = {
  currency: string;
  available: string;
  total: string;
  reserved?: string;
};

export interface ExecutionAdapter {
  readonly mode: ExecutionMode;
  readonly liveTradingEnabled: boolean;
  readonly liveExecutionDryRun: boolean;
  placeEntry(request: EntryOrderRequest): Promise<OrderResult>;
  closePosition(request: ClosePositionRequest): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<OrderResult>;
  getBalances(): Promise<BalanceSnapshot[]>;
  getOpenOrders(instrument?: string): Promise<unknown[]>;
  getOrderStatus(orderId: string): Promise<unknown>;
}
