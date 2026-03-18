export type VisibleBalance = {
  asset: string;
  total: string;
  available: string;
  reserved?: string;
};

export type CryptoComProbeDiagnostics = {
  cryptoComAuthConfigured: boolean;
  cryptoComAuthHealthy: boolean;
  cryptoComEndpointUsed?: string;
  cryptoComAuthErrorCode?: string;
  cryptoComAuthErrorMessage?: string;
  cryptoComCapabilities: {
    balances: boolean;
    openOrders: boolean;
    tradeHistory: boolean;
  };
  cryptoComAccountSummaryAvailable: boolean;
  cryptoComOpenOrdersAvailable: boolean;
  cryptoComTradeHistoryAvailable: boolean;
  cryptoComConnectionMessage: string;
  lastAuthenticatedProbeAt: string | null;
  warnings: string[];
  visibleBalances: VisibleBalance[];
  visibleBalanceCount: number;
  allBalancesZero: boolean;
  quoteBalanceUsdOrUsdt?: string;
};

export type CryptoComAuthProbeResult = {
  authConfigured: boolean;
  authSucceeded: boolean;
  endpointUsed: string;
  readableMessage: string;
  accountSummaryAvailable: boolean;
  visibleBalances: VisibleBalance[];
  visibleBalanceCount: number;
  allBalancesZero: boolean;
  quoteBalanceUsdOrUsdt?: string;
  errorCode?: string;
  errorMessage?: string;
};

export interface CryptoComReadOnlyClientLike {
  getBalances(): Promise<VisibleBalance[]>;
  getOpenOrders(instrumentName?: string): Promise<unknown[]>;
  getTradeHistory(instrumentName?: string): Promise<unknown[]>;
}

export function emptyCryptoComAuthProbeResult(): CryptoComAuthProbeResult {
  return {
    authConfigured: false,
    authSucceeded: false,
    endpointUsed: "private/user-balance",
    readableMessage: "Credentials not configured",
    accountSummaryAvailable: false,
    visibleBalances: [],
    visibleBalanceCount: 0,
    allBalancesZero: true
  };
}

export function emptyCryptoComProbeDiagnostics(): CryptoComProbeDiagnostics {
  return {
    cryptoComAuthConfigured: false,
    cryptoComAuthHealthy: false,
    cryptoComEndpointUsed: "private/user-balance",
    cryptoComCapabilities: {
      balances: false,
      openOrders: false,
      tradeHistory: false
    },
    cryptoComAccountSummaryAvailable: false,
    cryptoComOpenOrdersAvailable: false,
    cryptoComTradeHistoryAvailable: false,
    cryptoComConnectionMessage: "Credentials not configured",
    lastAuthenticatedProbeAt: null,
    warnings: [],
    visibleBalances: [],
    visibleBalanceCount: 0,
    allBalancesZero: true
  };
}

export function redactSensitiveText(input: string, secrets: string[]): string {
  return secrets.reduce((text, secret) => {
    if (!secret) {
      return text;
    }
    return text.split(secret).join("[REDACTED]");
  }, input);
}

function classifyWarning(message: string): string | null {
  const lower = message.toLowerCase();
  if (lower.includes("permission")) {
    return "permission-limited endpoint";
  }
  if (lower.includes("master") || lower.includes("sub-account") || lower.includes("sub account")) {
    return "possible master/sub-account restriction";
  }
  if (lower.includes("invalid api key") || lower.includes("signature") || lower.includes("unauthorized")) {
    return "invalid credentials or signature rejected";
  }
  return null;
}

function extractErrorParts(message: string): { errorCode?: string; errorMessage?: string } {
  const trimmed = message.trim();
  const codeMatch = /code\s+(-?\d+)/i.exec(trimmed);
  return {
    errorCode: codeMatch?.[1],
    errorMessage: trimmed || undefined
  };
}

function isZeroLike(value: string): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed === 0 : value.trim() === "0";
}

function summarizeBalances(balances: VisibleBalance[]): {
  visibleBalanceCount: number;
  allBalancesZero: boolean;
  quoteBalanceUsdOrUsdt?: string;
} {
  return {
    visibleBalanceCount: balances.length,
    allBalancesZero: balances.every(
      (balance) => isZeroLike(balance.total) && isZeroLike(balance.available) && (!balance.reserved || isZeroLike(balance.reserved))
    ),
    quoteBalanceUsdOrUsdt: balances.find((balance) => balance.asset === "USD" || balance.asset === "USDT")?.total
  };
}

export async function runCryptoComAuthProbe(input: {
  apiKey?: string;
  apiSecret?: string;
  clientFactory?: () => Pick<CryptoComReadOnlyClientLike, "getBalances">;
}): Promise<CryptoComAuthProbeResult> {
  const result = emptyCryptoComAuthProbeResult();
  const secrets = [input.apiKey ?? "", input.apiSecret ?? ""];
  if (!input.apiKey || !input.apiSecret) {
    return result;
  }

  result.authConfigured = true;
  const client = input.clientFactory?.();
  if (!client) {
    result.readableMessage = "Authenticated client unavailable";
    return result;
  }

  try {
    const balances = await client.getBalances();
    result.authSucceeded = true;
    result.accountSummaryAvailable = true;
    result.readableMessage = "Authenticated connectivity healthy";
    result.visibleBalances = balances;
    Object.assign(result, summarizeBalances(balances));
    return result;
  } catch (error) {
    const message = redactSensitiveText(error instanceof Error ? error.message : "unknown auth error", secrets);
    const parts = extractErrorParts(message);
    result.readableMessage = message;
    result.errorCode = parts.errorCode;
    result.errorMessage = parts.errorMessage;
    return result;
  }
}

export async function runCryptoComReadOnlyProbe(input: {
  apiKey?: string;
  apiSecret?: string;
  clientFactory?: () => CryptoComReadOnlyClientLike;
}): Promise<CryptoComProbeDiagnostics> {
  const diagnostics = emptyCryptoComProbeDiagnostics();
  const authClient = input.clientFactory?.();
  const baseProbe = await runCryptoComAuthProbe({
    apiKey: input.apiKey,
    apiSecret: input.apiSecret,
    clientFactory: authClient
      ? () => ({
          getBalances: (...args) => authClient.getBalances(...args)
        })
      : undefined
  });
  if (!baseProbe.authConfigured) {
    return diagnostics;
  }

  const secrets = [input.apiKey ?? "", input.apiSecret ?? ""];
  diagnostics.cryptoComAuthConfigured = baseProbe.authConfigured;
  diagnostics.cryptoComAuthHealthy = baseProbe.authSucceeded;
  diagnostics.cryptoComEndpointUsed = baseProbe.endpointUsed;
  diagnostics.cryptoComAuthErrorCode = baseProbe.errorCode;
  diagnostics.cryptoComAuthErrorMessage = baseProbe.errorMessage;
  diagnostics.cryptoComCapabilities.balances = baseProbe.accountSummaryAvailable;
  diagnostics.cryptoComAccountSummaryAvailable = baseProbe.accountSummaryAvailable;
  diagnostics.cryptoComConnectionMessage = baseProbe.readableMessage;
  diagnostics.visibleBalances = baseProbe.visibleBalances;
  diagnostics.visibleBalanceCount = baseProbe.visibleBalanceCount;
  diagnostics.allBalancesZero = baseProbe.allBalancesZero;
  diagnostics.quoteBalanceUsdOrUsdt = baseProbe.quoteBalanceUsdOrUsdt;

  const client = input.clientFactory?.();
  if (!client) {
    diagnostics.cryptoComConnectionMessage = "Authenticated client unavailable";
    return diagnostics;
  }

  const warnings = new Set<string>();
  const probedAt = new Date().toISOString();

  if (baseProbe.authSucceeded) {
  } else {
    const warning = classifyWarning(baseProbe.readableMessage);
    if (warning) {
      warnings.add(warning);
    }
  }

  try {
    await client.getOpenOrders();
    diagnostics.cryptoComAuthHealthy = true;
    diagnostics.cryptoComCapabilities.openOrders = true;
    diagnostics.cryptoComOpenOrdersAvailable = true;
  } catch (error) {
    const message = redactSensitiveText(error instanceof Error ? error.message : "unknown open orders error", secrets);
    const warning = classifyWarning(message);
    if (warning) {
      warnings.add(warning);
    }
  }

  try {
    await client.getTradeHistory();
    diagnostics.cryptoComAuthHealthy = true;
    diagnostics.cryptoComCapabilities.tradeHistory = true;
    diagnostics.cryptoComTradeHistoryAvailable = true;
  } catch (error) {
    const message = redactSensitiveText(error instanceof Error ? error.message : "unknown trade history error", secrets);
    const warning = classifyWarning(message);
    if (warning) {
      warnings.add(warning);
    }
  }

  diagnostics.lastAuthenticatedProbeAt = probedAt;
  diagnostics.warnings = Array.from(warnings);
  if (!diagnostics.cryptoComAuthHealthy && diagnostics.cryptoComConnectionMessage === "Authenticated probe pending") {
    diagnostics.cryptoComConnectionMessage = "Authenticated probe failed";
  }
  return diagnostics;
}
