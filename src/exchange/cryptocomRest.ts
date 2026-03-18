import { Candle } from "./types";

type CryptoComCandleRaw = {
  t?: number;
  o?: number | string;
  h?: number | string;
  l?: number | string;
  c?: number | string;
  v?: number | string;
};

type CryptoComResponse = {
  code?: number;
  result?: {
    data?: CryptoComCandleRaw[];
  };
};

type CryptoComInstrumentsResponse = {
  code?: number;
  result?: {
    instruments?: Array<{
      instrument_name?: string;
      quote_currency?: string;
      base_currency?: string;
      instrument_type?: string;
    }>;
  };
};

type CryptoComTickerResponse = {
  code?: number;
  result?: {
    data?:
      | Array<{
          i?: string;
          a?: string | number;
          c?: string | number;
          v?: string | number;
        }>
      | {
          i?: string;
          a?: string | number;
          c?: string | number;
          v?: string | number;
        };
  };
};

export type PublicInstrument = {
  instrumentName: string;
  quoteCurrency?: string;
  baseCurrency?: string;
  instrumentType?: string;
};

export type PublicTicker = {
  instrumentName: string;
  lastPrice: number;
  change24h?: number;
  volume24h?: number;
};

type MockCandleOptions = {
  seedPrice?: number;
  maxDeviationPct?: number;
};

function parseInstrumentParts(instrumentName: string): { baseCurrency?: string; quoteCurrency?: string } {
  const parts = instrumentName.split("_").filter(Boolean);
  if (parts.length < 2) {
    return {};
  }
  return {
    baseCurrency: parts.slice(0, -1).join("_"),
    quoteCurrency: parts[parts.length - 1]
  };
}

function toNumber(input: number | string | undefined): number | null {
  if (typeof input === "number") {
    return Number.isFinite(input) ? input : null;
  }
  if (typeof input === "string") {
    const parsed = Number(input);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeInstrument(instrument: string): string {
  const trimmed = instrument.trim().toUpperCase();
  if (trimmed.includes("_")) {
    return trimmed;
  }
  if (trimmed.endsWith("USDT")) {
    return `${trimmed.slice(0, -4)}_USDT`;
  }
  if (trimmed.endsWith("USD")) {
    return `${trimmed.slice(0, -3)}_USD`;
  }
  return trimmed;
}

function normalizeCandles(rawCandles: unknown): Candle[] {
  if (!Array.isArray(rawCandles)) {
    return [];
  }

  const normalized: Candle[] = [];
  for (const raw of rawCandles) {
    const candle = raw as CryptoComCandleRaw;
    const timestamp = toNumber(candle.t);
    const open = toNumber(candle.o);
    const high = toNumber(candle.h);
    const low = toNumber(candle.l);
    const close = toNumber(candle.c);
    const volume = toNumber(candle.v);

    if (
      timestamp === null ||
      open === null ||
      high === null ||
      low === null ||
      close === null ||
      volume === null
    ) {
      continue;
    }

    normalized.push({ timestamp, open, high, low, close, volume });
  }

  normalized.sort((a, b) => a.timestamp - b.timestamp);
  return normalized;
}

async function resolveFetch(): Promise<typeof fetch> {
  if (typeof globalThis.fetch === "function") {
    return globalThis.fetch.bind(globalThis);
  }

  const undici = await import("undici");
  return undici.fetch as unknown as typeof fetch;
}

async function fetchCryptoComJson(url: string, requestKind: string): Promise<unknown> {
  const fetchFn = await resolveFetch();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  let response: Response;
  try {
    response = await fetchFn(url, { method: "GET", signal: controller.signal });
  } catch (cause) {
    throw new Error(
      `Crypto.com ${requestKind} request network error: ${
        cause instanceof Error ? cause.message : "unknown fetch error"
      }`
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Crypto.com ${requestKind} request failed: HTTP ${response.status}`);
  }

  try {
    return (await response.json()) as unknown;
  } catch {
    throw new Error(`Crypto.com ${requestKind} response was not valid JSON`);
  }
}

export async function getCandles(instrument: string, timeframe: string): Promise<Candle[]> {
  const symbol = encodeURIComponent(normalizeInstrument(instrument));
  const tf = encodeURIComponent(timeframe);
  const url = `https://api.crypto.com/v2/public/get-candlestick?instrument_name=${symbol}&timeframe=${tf}`;
  const body = await fetchCryptoComJson(url, "candle");

  const parsed = body as CryptoComResponse;
  if (parsed.code !== 0) {
    throw new Error(`Crypto.com candle API returned code ${String(parsed.code ?? "unknown")}`);
  }

  const candles = normalizeCandles(parsed.result?.data);
  if (candles.length === 0) {
    throw new Error("Crypto.com candle API returned no valid candles");
  }

  return candles;
}

export async function getInstruments(): Promise<PublicInstrument[]> {
  const url = "https://api.crypto.com/v2/public/get-instruments";
  let body: CryptoComInstrumentsResponse;
  try {
    body = (await fetchCryptoComJson(url, "instrument")) as CryptoComInstrumentsResponse;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "unknown error";
    if (message.includes("HTTP 404")) {
      const tickers = await getTickers();
      const derived = deriveInstrumentsFromTickers(tickers);
      if (derived.length > 0) {
        return derived;
      }
    }
    throw cause;
  }

  if (body.code !== 0) {
    throw new Error(`Crypto.com instrument API returned code ${String(body.code ?? "unknown")}`);
  }

  const instruments = body.result?.instruments;
  if (!Array.isArray(instruments)) {
    throw new Error("Crypto.com instrument API returned invalid instrument payload");
  }

  return instruments
    .filter((item) => typeof item.instrument_name === "string" && item.instrument_name.length > 0)
    .map((item) => ({
      instrumentName: String(item.instrument_name),
      quoteCurrency: item.quote_currency,
      baseCurrency: item.base_currency,
      instrumentType: item.instrument_type
    }));
}

export function deriveInstrumentsFromTickers(tickers: PublicTicker[]): PublicInstrument[] {
  const byName = new Map<string, PublicInstrument>();
  for (const ticker of tickers) {
    const instrumentName = ticker.instrumentName.toUpperCase();
    const parts = parseInstrumentParts(instrumentName);
    byName.set(instrumentName, {
      instrumentName,
      baseCurrency: parts.baseCurrency,
      quoteCurrency: parts.quoteCurrency,
      instrumentType: "SPOT"
    });
  }
  return Array.from(byName.values());
}

function parseTickerItem(input: unknown): PublicTicker | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const row = input as { i?: unknown; a?: unknown; c?: unknown; v?: unknown };
  if (typeof row.i !== "string" || !row.i) {
    return null;
  }
  const lastPrice = toNumber(row.a as number | string | undefined);
  if (lastPrice === null || lastPrice <= 0) {
    return null;
  }

  const change24h = toNumber(row.c as number | string | undefined) ?? undefined;
  const volume24h = toNumber(row.v as number | string | undefined) ?? undefined;

  return {
    instrumentName: row.i,
    lastPrice,
    change24h,
    volume24h
  };
}

export async function getTickers(): Promise<PublicTicker[]> {
  const url = "https://api.crypto.com/v2/public/get-ticker";
  const body = (await fetchCryptoComJson(url, "ticker")) as CryptoComTickerResponse;
  if (body.code !== 0) {
    throw new Error(`Crypto.com ticker API returned code ${String(body.code ?? "unknown")}`);
  }

  const payload = body.result?.data;
  const rows = Array.isArray(payload) ? payload : payload ? [payload] : [];
  const parsed = rows
    .map((item) => parseTickerItem(item))
    .filter((item): item is PublicTicker => item !== null);

  if (parsed.length === 0) {
    throw new Error("Crypto.com ticker API returned no valid tickers");
  }
  return parsed;
}

function baselinePriceForInstrument(instrument?: string): number {
  if (!instrument) {
    return 1;
  }

  const upper = instrument.toUpperCase();
  const base = upper.includes("_") ? upper.split("_")[0] : upper;
  const known: Record<string, number> = {
    BTC: 50000,
    ETH: 3000,
    SOL: 150,
    XRP: 0.6,
    DOGE: 0.2,
    ADA: 0.6,
    SHIB: 0.00002,
    PEPE: 0.000002,
    ENJ: 0.3,
    NOT: 0.02
  };

  return known[base] ?? 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getMockCandles(size = 120, instrument?: string, options?: MockCandleOptions): Candle[] {
  const candles: Candle[] = [];
  const startTimestamp = Date.now() - size * 60_000;
  const baseline = baselinePriceForInstrument(instrument);
  const safeSeed =
    options?.seedPrice && Number.isFinite(options.seedPrice) && options.seedPrice > 0
      ? options.seedPrice
      : baseline;
  const maxDeviationPct = clamp(options?.maxDeviationPct ?? 0.15, 0.02, 0.35);
  const lowerBound = safeSeed * (1 - maxDeviationPct);
  const upperBound = safeSeed * (1 + maxDeviationPct);
  const stepLimitPct = 0.004;

  let price = safeSeed;
  let baseVolume = 100;

  for (let i = 0; i < size; i += 1) {
    const driftPct = (Math.random() - 0.5) * stepLimitPct * 2;
    const drift = price * driftPct;
    const open = price;
    const rawClose = open + drift;
    const close = clamp(rawClose, lowerBound, upperBound);
    const wickUp = Math.random() * close * 0.0025;
    const wickDown = Math.random() * close * 0.0025;
    const high = clamp(Math.max(open, close) + wickUp, lowerBound, upperBound);
    const low = clamp(Math.min(open, close) - wickDown, lowerBound, upperBound);
    baseVolume = Math.max(10, baseVolume + (Math.random() - 0.45) * 8);
    const volume = Math.max(1, baseVolume * (0.8 + Math.random() * 0.5));

    candles.push({
      timestamp: startTimestamp + i * 60_000,
      open,
      high,
      low,
      close,
      volume
    });

    price = clamp(close, lowerBound, upperBound);
  }

  return candles;
}
