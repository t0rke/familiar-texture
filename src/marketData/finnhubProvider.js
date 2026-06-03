import { normalizeCandles, normalizeInterval, normalizeSymbol } from "./candleNormalizer.js";

function getUnixSeconds(date) {
  return Math.floor(date.getTime() / 1000);
}

export async function fetchFinnhubCandles({ interval, lookbackMinutes, symbol }) {
  const token = process.env.FINNHUB_API_KEY;

  if (!token) {
    return {
      candles: [],
      provider: "finnhub",
      reason: "FINNHUB_API_KEY is not configured.",
    };
  }

  const to = new Date();
  const from = new Date(to.getTime() - Number(lookbackMinutes) * 60 * 1000);
  const url = new URL("https://finnhub.io/api/v1/stock/candle");
  url.searchParams.set("symbol", normalizeSymbol(symbol));
  url.searchParams.set("resolution", normalizeInterval(interval));
  url.searchParams.set("from", String(getUnixSeconds(from)));
  url.searchParams.set("to", String(getUnixSeconds(to)));
  url.searchParams.set("token", token);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Finnhub candle request failed: HTTP ${response.status}`);
  }

  const data = await response.json();
  if (data.s !== "ok") {
    return {
      candles: [],
      provider: "finnhub",
      reason: `Finnhub returned status ${data.s ?? "unknown"}.`,
    };
  }

  const candles = normalizeCandles(
    data.t.map((timestamp, index) => ({
      close: data.c[index],
      high: data.h[index],
      low: data.l[index],
      open: data.o[index],
      rawJson: {
        c: data.c[index],
        h: data.h[index],
        l: data.l[index],
        o: data.o[index],
        s: data.s,
        t: timestamp,
        v: data.v[index],
      },
      timestamp: new Date(timestamp * 1000),
      volume: data.v[index],
    })),
    {
      interval,
      source: "finnhub",
      symbol,
    }
  );

  return {
    candles,
    provider: "finnhub",
    reason: candles.length ? "Finnhub candles loaded." : "Finnhub returned no candles.",
  };
}
