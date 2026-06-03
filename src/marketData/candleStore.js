import { prisma } from "../core/db.js";
import { normalizeCandles, normalizeInterval, normalizeSymbol } from "./candleNormalizer.js";

export async function saveCandles(candles) {
  const normalized = normalizeCandles(candles, {
    interval: candles?.[0]?.interval,
    source: candles?.[0]?.source,
    symbol: candles?.[0]?.symbol,
  });

  for (const candle of normalized) {
    await prisma.candle.upsert({
      create: candle,
      update: {
        close: candle.close,
        high: candle.high,
        isDelayed: candle.isDelayed,
        low: candle.low,
        open: candle.open,
        rawJson: candle.rawJson,
        receivedAt: candle.receivedAt,
        volume: candle.volume,
      },
      where: {
        symbol_interval_timestamp_source: {
          interval: candle.interval,
          source: candle.source,
          symbol: candle.symbol,
          timestamp: candle.timestamp,
        },
      },
    });
  }

  return normalized;
}

export async function readCachedCandles({ interval, limit = 200, symbol }) {
  return prisma.candle.findMany({
    orderBy: {
      timestamp: "desc",
    },
    take: limit,
    where: {
      interval: normalizeInterval(interval),
      symbol: normalizeSymbol(symbol),
    },
  }).then((rows) => rows.reverse());
}
