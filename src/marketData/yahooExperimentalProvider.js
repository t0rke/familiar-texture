export async function fetchYahooExperimentalCandles({ settings }) {
  if (!settings.marketData.experimentalScrapingEnabled) {
    return {
      candles: [],
      liveSafe: false,
      provider: "yahooExperimental",
      reason: "Experimental scraping is disabled.",
    };
  }

  return {
    candles: [],
    liveSafe: false,
    provider: "yahooExperimental",
    reason: "Experimental scraping is intentionally not implemented for live trading.",
  };
}
