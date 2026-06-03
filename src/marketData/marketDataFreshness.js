export function getLatestCandle(candles) {
  return [...(candles ?? [])].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0] ?? null;
}

export function assessCandleFreshness(candles, settings) {
  const latest = getLatestCandle(candles);
  const maxAgeMs = Number(settings.marketData.maxCandleAgeSeconds) * 1000;
  const now = Date.now();

  if (!latest) {
    return {
      ageSeconds: null,
      fresh: false,
      liveSafe: false,
      reason: "No candles are available.",
    };
  }

  const ageSeconds = Math.max(0, Math.round((now - latest.timestamp.getTime()) / 1000));
  const fresh = Number.isFinite(maxAgeMs) && now - latest.timestamp.getTime() <= maxAgeMs;
  const liveSafe = fresh && !latest.isDelayed;

  return {
    ageSeconds,
    fresh,
    latestAt: latest.timestamp.toISOString(),
    liveSafe,
    reason: liveSafe ? "Candles are fresh and live-safe." : "Candles are stale or delayed.",
  };
}
