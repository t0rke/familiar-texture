import { normalizeCandles, normalizeInterval, normalizeSymbol } from "./candleNormalizer.js";

export async function fetchTwelveDataCandles({ interval, lookbackMinutes, symbol }) {
  const token = process.env.TWELVE_DATA_API_KEY;

  if (!token) {
    return {
      candles: [],
      provider: "twelveData",
      reason: "TWELVE_DATA_API_KEY is not configured.",
    };
  }

  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("apikey", token);
  url.searchParams.set("interval", `${normalizeInterval(interval)}min`);
  url.searchParams.set("outputsize", String(Math.max(1, Number(lookbackMinutes))));
  url.searchParams.set("symbol", normalizeSymbol(symbol));

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Twelve Data candle request failed: HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data.values)) {
    return {
      candles: [],
      provider: "twelveData",
      reason: data.message ?? data.status ?? "Twelve Data returned no candles.",
    };
  }

  return {
    candles: normalizeCandles(
      data.values.map((row) => ({
        close: row.close,
        high: row.high,
        low: row.low,
        open: row.open,
        rawJson: row,
        timestamp: new Date(row.datetime),
        volume: row.volume,
      })),
      {
        interval,
        source: "twelveData",
        symbol,
      }
    ),
    provider: "twelveData",
    reason: "Twelve Data candles loaded.",
  };
}
