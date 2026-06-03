import { atr, rsi, sma, vwap } from "./indicators.js";

function hold(reason, extra = {}) {
  return {
    action: "hold",
    reason,
    ...extra,
  };
}

function last(values) {
  return values[values.length - 1] ?? null;
}

export function aaoiDipReversalStrategy({ candles = [], marketCandles = [], settings }) {
  const params = settings.strategyParams.aaoi_dip_reversal;
  const symbol = params.symbol ?? "AAOI";
  const metadata = {
    candles: candles.length,
    marketCandles: marketCandles.length,
  };

  if (!settings.strategy.allowedSymbols.includes(symbol)) {
    return hold(`${symbol} is not allowed for trading.`, { metadata });
  }

  if (candles.length < params.minCandles) {
    return hold(`AAOI dip-reversal: need at least ${params.minCandles} candles.`, { metadata });
  }

  const closes = candles.map((candle) => Number(candle.close));
  const volumes = candles.map((candle) => Number(candle.volume ?? 0));
  const latest = last(candles);
  const previous = candles[candles.length - 2];
  const latestRsi = rsi(closes, params.rsiPeriod);
  const latestAtr = atr(candles, params.atrPeriod);
  const latestVwap = vwap(candles);
  const averageVolume = sma(volumes, params.volumeAveragePeriod);
  const marketCloses = marketCandles.map((candle) => Number(candle.close));
  const marketOk = marketCloses.length < 2 || last(marketCloses) >= marketCloses[marketCloses.length - 2] * 0.996;

  let score = 0;
  const reasons = [];

  if (latest.close > latest.open) {
    score += 2;
    reasons.push("green reversal candle");
  }

  if (previous && latest.low <= previous.low && latest.close > previous.close) {
    score += 2;
    reasons.push("undercut and reclaim");
  }

  if (latestRsi != null && latestRsi >= params.rsiRecovery) {
    score += 2;
    reasons.push(`RSI recovered to ${latestRsi.toFixed(1)}`);
  } else if (latestRsi != null && latestRsi <= params.rsiOversold) {
    score += 1;
    reasons.push(`RSI oversold at ${latestRsi.toFixed(1)}`);
  }

  if (averageVolume && latest.volume && latest.volume >= averageVolume) {
    score += 1;
    reasons.push("volume confirmation");
  }

  if (latestVwap != null && latest.close >= latestVwap * 0.995) {
    score += 1;
    reasons.push("near VWAP");
  }

  if (marketOk) {
    score += 1;
    reasons.push("market confirmation acceptable");
  }

  metadata.score = score;
  metadata.reasons = reasons;
  metadata.rsi = latestRsi;
  metadata.vwap = latestVwap;

  if (score < params.minScoreToTrade || !latestAtr) {
    return hold(`AAOI dip-reversal: score ${score}/${params.minScoreToTrade}; holding.`, {
      metadata,
    });
  }

  const stopPrice = Math.min(
    latest.low * (1 - params.stopBufferPercent / 100),
    latest.close - latestAtr * params.atrStopMultiplier
  );
  const riskPerShare = latest.close - stopPrice;
  const targetPrice = latest.close + riskPerShare * params.minRewardRisk;

  if (riskPerShare <= 0 || targetPrice <= latest.close) {
    return hold("AAOI dip-reversal: invalid stop/target geometry.", { metadata });
  }

  return {
    action: "trade",
    assetType: "equity",
    confidence: Math.min(0.99, settings.modelTuning.confidenceThreshold + score / 100),
    dollars: Math.min(params.defaultDollars, settings.risk.maxDollarsPerTrade),
    metadata: {
      ...metadata,
      atr: latestAtr,
      entryReferencePrice: latest.close,
      stopPrice,
      targetPrice,
    },
    orderType: "market",
    reason: `AAOI dip-reversal: ${reasons.join(", ")}.`,
    side: "buy",
    stopPrice: Number(stopPrice.toFixed(2)),
    symbol,
  };
}
