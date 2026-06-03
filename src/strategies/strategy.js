import { getSettings, STRATEGY_DEFINITIONS } from "../core/configStore.js";

function safeIncludes(text, value) {
  return String(text ?? "").toUpperCase().includes(String(value).toUpperCase());
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getQuoteRows(parsedQuotes) {
  return parsedQuotes?.data?.results ?? [];
}

function getPositions(parsedPositions) {
  return parsedPositions?.data?.positions ?? [];
}

function getCurrentPrice(quoteRow) {
  return numberOrNull(quoteRow?.quote?.last_trade_price);
}

function getPreviousClose(quoteRow) {
  return (
    numberOrNull(quoteRow?.close?.price) ??
    numberOrNull(quoteRow?.quote?.adjusted_previous_close) ??
    numberOrNull(quoteRow?.quote?.previous_close)
  );
}

function firstTradeableSymbol(settings) {
  return (
    settings.strategy.watchSymbols.find((symbol) =>
      settings.strategy.allowedSymbols.includes(symbol)
    ) ?? settings.strategy.allowedSymbols[0]
  );
}

function hold(reason, extra = {}) {
  return {
    action: "hold",
    reason,
    ...extra,
  };
}

function trade(payload) {
  return {
    action: "trade",
    assetType: "equity",
    confidence: 0.75,
    orderType: "market",
    side: "buy",
    ...payload,
  };
}

function starterVooStrategy({ positionsText, recentOrdersText, settings }) {
  const symbol = settings.strategy.watchSymbols.includes("VOO")
    ? "VOO"
    : firstTradeableSymbol(settings);

  if (!symbol) {
    return hold("Starter strategy: no allowed symbol is configured.");
  }

  const alreadyOwnsSymbol = safeIncludes(positionsText, symbol);

  if (alreadyOwnsSymbol) {
    return hold(`Starter strategy: already holding ${symbol}, so no new buy is needed.`);
  }

  const recentlyBoughtSymbol =
    safeIncludes(recentOrdersText, symbol) && safeIncludes(recentOrdersText, "buy");

  if (recentlyBoughtSymbol) {
    return hold(
      `Starter strategy: recent ${symbol} buy detected in order history, so no duplicate order.`
    );
  }

  return trade({
    confidence: settings.modelTuning.confidenceThreshold,
    dollars: Math.min(settings.strategy.fixedDcaAmount, settings.risk.maxDollarsPerTrade),
    reason: `Starter strategy: no ${symbol} position detected, so buy a starter allocation.`,
    symbol,
  });
}

function fixedDcaStrategy({ settings }) {
  const symbol = firstTradeableSymbol(settings);

  if (!symbol) {
    return hold("Fixed DCA: no allowed watchlist symbol is configured.");
  }

  return trade({
    confidence: settings.modelTuning.confidenceThreshold,
    dollars: Math.min(settings.strategy.fixedDcaAmount, settings.risk.maxDollarsPerTrade),
    reason: `Fixed DCA: buy ${symbol} using fixed dollar sizing.`,
    symbol,
  });
}

function dipBuyerStrategy({ parsedQuotes, settings }) {
  const threshold = settings.modelTuning.dipBuyThresholdPercent;

  for (const row of getQuoteRows(parsedQuotes)) {
    const symbol = row?.quote?.symbol;
    const current = getCurrentPrice(row);
    const previousClose = getPreviousClose(row);

    if (!symbol || current == null || previousClose == null || previousClose <= 0) {
      continue;
    }

    if (!settings.strategy.allowedSymbols.includes(symbol)) {
      continue;
    }

    const dropPercent = ((previousClose - current) / previousClose) * 100;

    if (dropPercent >= threshold) {
      return trade({
        confidence: Math.min(0.99, settings.modelTuning.confidenceThreshold + dropPercent / 100),
        dollars: Math.min(settings.strategy.fixedDcaAmount, settings.risk.maxDollarsPerTrade),
        reason: `Dip buyer: ${symbol} is down ${dropPercent.toFixed(2)}%, meeting the ${threshold}% threshold.`,
        symbol,
      });
    }
  }

  return hold(`Dip buyer: no watched symbol is down at least ${threshold}%.`);
}

function rebalanceStrategy({ parsedPortfolio, parsedPositions, settings }) {
  const positions = getPositions(parsedPositions);
  const totalValue = numberOrNull(parsedPortfolio?.data?.total_value);
  const threshold = settings.modelTuning.rebalanceThresholdPercent;

  if (!positions.length || !totalValue || totalValue <= 0) {
    return hold("Rebalance: portfolio data is not available yet.");
  }

  const targetSymbols = settings.strategy.watchSymbols.filter((symbol) =>
    settings.strategy.allowedSymbols.includes(symbol)
  );
  const targetWeight = targetSymbols.length ? 100 / targetSymbols.length : 0;

  for (const symbol of targetSymbols) {
    const position = positions.find((item) => item.symbol === symbol);
    const quantity = numberOrNull(position?.quantity) ?? 0;
    const average = numberOrNull(position?.average_buy_price) ?? 0;
    const allocation = ((quantity * average) / totalValue) * 100;

    if (targetWeight - allocation >= threshold) {
      return trade({
        confidence: settings.modelTuning.confidenceThreshold,
        dollars: Math.min(settings.strategy.fixedDcaAmount, settings.risk.maxDollarsPerTrade),
        reason: `Rebalance: ${symbol} is below target allocation by ${(targetWeight - allocation).toFixed(1)}%.`,
        symbol,
      });
    }

    if (
      allocation - targetWeight >= threshold &&
      settings.strategy.allowSells &&
      settings.risk.maxDailySellAmount > 0
    ) {
      return trade({
        confidence: settings.modelTuning.confidenceThreshold,
        dollars: Math.min(settings.strategy.fixedDcaAmount, settings.risk.maxDailySellAmount),
        reason: `Rebalance: ${symbol} is above target allocation by ${(allocation - targetWeight).toFixed(1)}%.`,
        side: "sell",
        symbol,
      });
    }
  }

  return hold(`Rebalance: all configured symbols are within ${threshold}% of target.`);
}

function manualSignalStrategy({ settings }) {
  const signal = settings.strategy.manualSignal;

  if (!signal) {
    return hold("Manual signal: no manual trade proposal is configured.");
  }

  return trade({
    ...signal,
    confidence: signal.confidence ?? settings.modelTuning.confidenceThreshold,
    reason: signal.reason ?? "Manual signal: user-created trade proposal.",
  });
}

export const strategies = {
  dip_buyer: dipBuyerStrategy,
  fixed_dca: fixedDcaStrategy,
  manual_signal: manualSignalStrategy,
  rebalance: rebalanceStrategy,
  starter_voo: starterVooStrategy,
};

export function getStrategyDefinitions() {
  return STRATEGY_DEFINITIONS;
}

export async function getTradeIdea({
  parsedOrders,
  parsedPortfolio,
  parsedPositions,
  parsedQuotes,
  portfolioText,
  positionsText,
  quotesText,
  recentOrdersText,
  settings = getSettings(),
}) {
  const strategy = strategies[settings.strategy.activeStrategy];

  if (!strategy) {
    throw new Error(`Unknown strategy: ${settings.strategy.activeStrategy}`);
  }

  return strategy({
    parsedOrders,
    parsedPortfolio,
    parsedPositions,
    parsedQuotes,
    portfolioText,
    positionsText,
    quotesText,
    recentOrdersText,
    settings,
  });
}
