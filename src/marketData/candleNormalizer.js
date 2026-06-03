function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeSymbol(symbol) {
  return String(symbol ?? "").trim().toUpperCase();
}

export function normalizeInterval(interval) {
  return String(interval ?? "1").trim();
}

export function normalizeCandle(input, { interval, source, symbol }) {
  const timestamp = input.timestamp instanceof Date ? input.timestamp : new Date(input.timestamp);
  const open = numberOrNull(input.open);
  const high = numberOrNull(input.high);
  const low = numberOrNull(input.low);
  const close = numberOrNull(input.close);

  if (!normalizeSymbol(symbol) || !Number.isFinite(timestamp.getTime())) return null;
  if ([open, high, low, close].some((value) => value == null)) return null;

  return {
    close,
    high,
    interval: normalizeInterval(interval),
    isDelayed: Boolean(input.isDelayed),
    low,
    open,
    rawJson: input.rawJson ?? input,
    receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
    source,
    symbol: normalizeSymbol(symbol),
    timestamp,
    volume: numberOrNull(input.volume),
  };
}

export function normalizeCandles(values, context) {
  return (values ?? [])
    .map((value) => normalizeCandle(value, context))
    .filter(Boolean)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}
