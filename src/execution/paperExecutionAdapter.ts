import { BalanceSnapshot, ClosePositionRequest, EntryOrderRequest, ExecutionAdapter, OrderResult } from "./types";

export class PaperExecutionAdapter implements ExecutionAdapter {
  public readonly mode = "paper" as const;
  public readonly liveTradingEnabled = false;
  public readonly liveExecutionDryRun = true;

  public async placeEntry(request: EntryOrderRequest): Promise<OrderResult> {
    return {
      clientOrderId: request.clientOrderId,
      status: "PAPER_NOOP",
      submissionState: "PAPER_NOOP",
      confirmedByExchange: false,
      pendingConfirmation: false,
      dryRun: true,
      summary: "Paper adapter did not submit an exchange order"
    };
  }

  public async closePosition(request: ClosePositionRequest): Promise<OrderResult> {
    return {
      clientOrderId: request.clientOrderId,
      status: "PAPER_NOOP",
      submissionState: "PAPER_NOOP",
      confirmedByExchange: false,
      pendingConfirmation: false,
      dryRun: true,
      summary: "Paper adapter did not submit an exchange order"
    };
  }

  public async cancelOrder(orderId: string): Promise<OrderResult> {
    return {
      orderId,
      status: "PAPER_NOOP",
      submissionState: "PAPER_NOOP",
      confirmedByExchange: false,
      pendingConfirmation: false,
      dryRun: true,
      summary: "Paper adapter did not submit an exchange cancel"
    };
  }

  public async getBalances(): Promise<BalanceSnapshot[]> {
    return [];
  }

  public async getOpenOrders(): Promise<unknown[]> {
    return [];
  }

  public async getOrderStatus(orderId: string): Promise<unknown> {
    return {
      orderId,
      status: "PAPER_NOOP",
      submissionState: "PAPER_NOOP"
    };
  }
}
