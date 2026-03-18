import { ExitReason, Position } from "../exchange/types";

export class PaperPositionManager {
  private readonly positions = new Map<string, Position>();

  constructor(private readonly maxOpenPositions: number) {}

  public canOpenPosition(instrument: string): boolean {
    if (this.positions.has(instrument)) {
      return false;
    }

    return this.positions.size < this.maxOpenPositions;
  }

  public hasOpenPosition(instrument: string): boolean {
    return this.positions.has(instrument);
  }

  public getOpenPosition(instrument: string): Position | undefined {
    return this.positions.get(instrument);
  }

  public listOpenPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  public restoreOpenPositions(positions: Position[]): void {
    this.positions.clear();
    for (const position of positions) {
      if (position.status !== "OPEN") {
        continue;
      }
      this.positions.set(position.instrument, position);
    }
  }

  public openPaperPosition(params: {
    instrument: string;
    entryPrice: number;
    usdNotional: number;
    stopLoss: number;
    takeProfit: number;
    openedAt: string;
    positionSizeUsd?: number;
    sizingMode?: Position["sizingMode"];
    sizingRegimeMultiplier?: number;
    sizingScoreMultiplier?: number;
    entryRegime?: Position["entryRegime"];
    entryRegimeConfidence?: Position["entryRegimeConfidence"];
    entryBreadthScore?: number;
    entryVolatilityPct?: number;
    entryEmaSpreadPct?: number;
  }): Position {
    if (!this.canOpenPosition(params.instrument)) {
      throw new Error(`Cannot open position for ${params.instrument}: risk limits hit`);
    }

    if (params.entryPrice <= 0 || params.usdNotional <= 0) {
      throw new Error("entryPrice and usdNotional must be greater than zero");
    }

    const quantity = params.usdNotional / params.entryPrice;
    const position: Position = {
      instrument: params.instrument,
      entryPrice: params.entryPrice,
      quantity,
      positionSizeUsd: params.positionSizeUsd ?? params.usdNotional,
      sizingMode: params.sizingMode,
      sizingRegimeMultiplier: params.sizingRegimeMultiplier,
      sizingScoreMultiplier: params.sizingScoreMultiplier,
      openedAt: params.openedAt,
      stopLoss: params.stopLoss,
      takeProfit: params.takeProfit,
      highestSeenPrice: params.entryPrice,
      entryRegime: params.entryRegime,
      entryRegimeConfidence: params.entryRegimeConfidence,
      entryBreadthScore: params.entryBreadthScore,
      entryVolatilityPct: params.entryVolatilityPct,
      entryEmaSpreadPct: params.entryEmaSpreadPct,
      mfeUsd: 0,
      maeUsd: 0,
      status: "OPEN"
    };

    this.positions.set(params.instrument, position);
    return position;
  }

  public updateHighestSeenPrice(
    instrument: string,
    latestPrice: number
  ): { position?: Position; updated: boolean } {
    return this.observePrice(instrument, latestPrice);
  }

  public observePrice(instrument: string, latestPrice: number): { position?: Position; updated: boolean } {
    const position = this.positions.get(instrument);
    if (!position) {
      return { updated: false };
    }

    const currentPnlUsd = (latestPrice - position.entryPrice) * position.quantity;
    const nextHighestSeenPrice = latestPrice > position.highestSeenPrice ? latestPrice : position.highestSeenPrice;
    const nextMfeUsd = Math.max(position.mfeUsd ?? 0, currentPnlUsd);
    const nextMaeUsd = Math.min(position.maeUsd ?? 0, currentPnlUsd);
    const changed =
      nextHighestSeenPrice !== position.highestSeenPrice ||
      nextMfeUsd !== (position.mfeUsd ?? 0) ||
      nextMaeUsd !== (position.maeUsd ?? 0);

    if (changed) {
      const updated: Position = {
        ...position,
        highestSeenPrice: nextHighestSeenPrice,
        mfeUsd: nextMfeUsd,
        maeUsd: nextMaeUsd
      };
      this.positions.set(instrument, updated);
      return { position: updated, updated: true };
    }

    return { position, updated: false };
  }

  public static trailingStopPrice(highestSeenPrice: number, trailingStopPct: number): number {
    if (highestSeenPrice <= 0) {
      throw new Error("highestSeenPrice must be greater than zero");
    }
    if (trailingStopPct <= 0 || trailingStopPct >= 1) {
      throw new Error("trailingStopPct must be between 0 and 1");
    }
    return highestSeenPrice * (1 - trailingStopPct);
  }

  public static shouldExitByTrailingStop(
    latestPrice: number,
    highestSeenPrice: number,
    trailingStopPct: number
  ): boolean {
    const threshold = PaperPositionManager.trailingStopPrice(highestSeenPrice, trailingStopPct);
    return latestPrice <= threshold;
  }

  public closePosition(params: {
    instrument: string;
    exitPrice: number;
    closedAt: string;
    exitReason: ExitReason;
  }): {
    closedPosition: Position;
    realizedPnl: number;
    closedAt: string;
    exitPrice: number;
  } {
    const openPosition = this.positions.get(params.instrument);
    if (!openPosition) {
      throw new Error(`No open position for ${params.instrument}`);
    }

    const realizedPnl = (params.exitPrice - openPosition.entryPrice) * openPosition.quantity;
    const closedPosition: Position = {
      ...openPosition,
      status: "CLOSED",
      exitReason: params.exitReason
    };
    this.positions.delete(params.instrument);

    return {
      closedPosition,
      realizedPnl,
      closedAt: params.closedAt,
      exitPrice: params.exitPrice
    };
  }
}
