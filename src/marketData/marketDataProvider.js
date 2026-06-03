import { readCachedCandles, saveCandles } from "./candleStore.js";
import { fetchFinnhubCandles } from "./finnhubProvider.js";
import { assessCandleFreshness } from "./marketDataFreshness.js";
import { fetchTwelveDataCandles } from "./twelveDataProvider.js";
import { fetchYahooExperimentalCandles } from "./yahooExperimentalProvider.js";

const providers = {
  finnhub: fetchFinnhubCandles,
  twelveData: fetchTwelveDataCandles,
  yahooExperimental: fetchYahooExperimentalCandles,
};

export async function getCandles({ settings, symbol }) {
  const context = {
    interval: settings.marketData.interval,
    lookbackMinutes: settings.marketData.lookbackMinutes,
    settings,
    symbol,
  };
  const attempts = [];

  for (const providerName of settings.marketData.providerPriority) {
    const provider = providers[providerName];
    if (!provider) continue;

    try {
      const result = await provider(context);
      attempts.push({
        provider: result.provider ?? providerName,
        reason: result.reason,
      });

      if (result.candles?.length) {
        const candles = await saveCandles(result.candles);
        return {
          attempts,
          candles,
          freshness: assessCandleFreshness(candles, settings),
          provider: result.provider ?? providerName,
        };
      }
    } catch (err) {
      attempts.push({
        provider: providerName,
        reason: err.message,
      });
    }
  }

  const cached = await readCachedCandles({
    interval: settings.marketData.interval,
    limit: settings.marketData.lookbackMinutes,
    symbol,
  });

  return {
    attempts,
    candles: cached,
    freshness: assessCandleFreshness(cached, settings),
    provider: cached.length ? "cache" : "none",
  };
}
