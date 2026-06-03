function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((sum, value) => sum + value, 0) / period;
}

export function vwap(candles) {
  let totalPriceVolume = 0;
  let totalVolume = 0;

  for (const candle of candles) {
    const high = numberOrNull(candle.high);
    const low = numberOrNull(candle.low);
    const close = numberOrNull(candle.close);
    const volume = numberOrNull(candle.volume);

    if ([high, low, close, volume].some((value) => value == null) || volume <= 0) continue;

    totalPriceVolume += ((high + low + close) / 3) * volume;
    totalVolume += volume;
  }

  return totalVolume > 0 ? totalPriceVolume / totalVolume : null;
}

export function rsi(closes, period = 14) {
  if (closes.length <= period) return null;

  const deltas = closes.slice(1).map((close, index) => close - closes[index]);
  const recent = deltas.slice(-period);
  const gains = recent.filter((delta) => delta > 0).reduce((sum, delta) => sum + delta, 0);
  const losses = Math.abs(
    recent.filter((delta) => delta < 0).reduce((sum, delta) => sum + delta, 0)
  );

  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

export function atr(candles, period = 14) {
  if (candles.length <= period) return null;
  const ranges = [];

  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    ranges.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close)
      )
    );
  }

  return sma(ranges, period);
}
