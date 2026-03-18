import { BotConfig } from "../exchange/types";
import { CryptoComLiveExecutionAdapter } from "./cryptoComLiveExecutionAdapter";
import { PaperExecutionAdapter } from "./paperExecutionAdapter";
import { ExecutionAdapter } from "./types";

export function createExecutionAdapter(config: BotConfig): ExecutionAdapter {
  if (config.executionMode !== "live") {
    return new PaperExecutionAdapter();
  }
  if (!config.liveTradingEnabled) {
    throw new Error("EXECUTION_MODE=live requires LIVE_TRADING_ENABLED=true");
  }
  if (!config.cryptocomApiKey || !config.cryptocomApiSecret) {
    throw new Error("Live execution requires CRYPTOCOM_API_KEY and CRYPTOCOM_API_SECRET");
  }
  return new CryptoComLiveExecutionAdapter({
    apiKey: config.cryptocomApiKey,
    apiSecret: config.cryptocomApiSecret,
    apiBaseUrl: config.cryptocomExchangePrivateBaseUrl,
    dryRun: config.liveExecutionDryRun
  });
}
