import { getSettings } from "./configStore.js";

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getTradeDollarValue(trade) {
  return (
    numberOrNull(trade.dollars) ??
    numberOrNull(trade.dollar_amount) ??
    numberOrNull(trade.estimatedDollars) ??
    null
  );
}

function getBuyingPower({ buyingPower, portfolio }) {
  return (
    numberOrNull(buyingPower) ??
    numberOrNull(portfolio?.buying_power?.buying_power) ??
    numberOrNull(portfolio?.buyingPower?.buyingPower) ??
    null
  );
}

function getPortfolioValue(portfolio) {
  return numberOrNull(portfolio?.total_value) ?? numberOrNull(portfolio?.totalValue);
}

function getPositionMarketValue(position) {
  const marketValue = numberOrNull(position.market_value) ?? numberOrNull(position.marketValue);
  if (marketValue != null) return marketValue;

  const quantity = numberOrNull(position.quantity);
  const averageBuyPrice =
    numberOrNull(position.average_buy_price) ?? numberOrNull(position.averageBuyPrice);

  if (quantity == null || averageBuyPrice == null) return 0;

  return quantity * averageBuyPrice;
}

function getSymbolAllocationPercent({ portfolio, positions, symbol, proposedDollars = 0 }) {
  const portfolioValue = getPortfolioValue(portfolio);

  if (!portfolioValue || portfolioValue <= 0) {
    return null;
  }

  const currentPositionValue = (positions ?? [])
    .filter((position) => position.symbol?.toUpperCase() === symbol)
    .reduce((sum, position) => sum + getPositionMarketValue(position), 0);

  return ((currentPositionValue + proposedDollars) / portfolioValue) * 100;
}

function asDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

export function assertLiveOrderAllowed(settings = getSettings()) {
  if (settings.mode.dryRun) {
    throw new Error("Blocked: dry run mode is enabled.");
  }

  if (!settings.mode.tradingEnabled) {
    throw new Error("Blocked: trading is disabled.");
  }

  if (!settings.mode.confirmLiveOrder) {
    throw new Error("Blocked: live order confirmation is disabled.");
  }

  if (settings.risk.requireManualConfirmationForLive) {
    throw new Error(
      "Blocked: live orders require manual UI confirmation before placement."
    );
  }
}

export function validateTrade(
  trade,
  {
    buyingPower,
    dailySellAmount = 0,
    dailySpend = 0,
    lastTradeAt = null,
    portfolio = null,
    positions = [],
    settings = getSettings(),
    tradesToday = 0,
  } = {}
) {
  const checks = [];
  const symbol = trade.symbol?.toUpperCase();
  const dollars = getTradeDollarValue(trade);
  const side = String(trade.side ?? "").toLowerCase();

  function pass(name, detail) {
    checks.push({ detail, name, passed: true });
  }

  function block(name, detail) {
    checks.push({ detail, name, passed: false });
    const error = new Error(`Blocked: ${detail}`);
    error.riskChecks = checks;
    throw error;
  }

  if (!symbol) block("symbol", "missing symbol.");
  pass("symbol", `${symbol} provided.`);

  if (!settings.strategy.allowedSymbols.includes(symbol)) {
    block("allowlist", `${symbol} is not in allowedSymbols.`);
  }
  pass("allowlist", `${symbol} is allowed.`);

  if (settings.strategy.blockedSymbols.includes(symbol)) {
    block("blocklist", `${symbol} is in blockedSymbols.`);
  }
  pass("blocklist", `${symbol} is not blocked.`);

  if (!["buy", "sell"].includes(side)) {
    block("side", `invalid side ${trade.side}.`);
  }
  pass("side", `${side} is a supported side.`);

  if (side === "buy" && !settings.strategy.allowBuys) {
    block("allowBuys", "buying is disabled.");
  }
  pass("allowBuys", "buying gate satisfied.");

  if (side === "sell" && !settings.strategy.allowSells) {
    block("allowSells", "selling is disabled.");
  }
  pass("allowSells", "selling gate satisfied.");

  if (trade.assetType === "option" && !settings.strategy.allowOptions) {
    block("allowOptions", "options are disabled.");
  }
  pass("allowOptions", "asset type is not blocked by options gate.");

  if (trade.assetType === "crypto" && !settings.strategy.allowCrypto) {
    block("allowCrypto", "crypto is disabled.");
  }
  pass("allowCrypto", "asset type is not blocked by crypto gate.");

  if (trade.quantity != null && dollars != null) {
    block("sizing", "provide either quantity or dollars, not both.");
  }

  if (dollars != null) {
    if (dollars <= 0) {
      block("sizing", "invalid dollar amount.");
    }

    if (dollars > settings.risk.maxDollarsPerTrade) {
      block(
        "maxDollarsPerTrade",
        `$${dollars} exceeds max $${settings.risk.maxDollarsPerTrade}.`
      );
    }

    pass("maxDollarsPerTrade", `$${dollars} is within per-trade limit.`);
  }

  if (trade.quantity != null) {
    const quantity = Number(trade.quantity);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      block("quantity", "invalid quantity.");
    }

    pass("quantity", `${quantity} quantity is valid.`);
  }

  if (tradesToday >= settings.risk.maxTradesPerDay) {
    block("maxTradesPerDay", "max trades per day reached.");
  }
  pass("maxTradesPerDay", `${tradesToday}/${settings.risk.maxTradesPerDay} trades used.`);

  if (side === "buy" && dollars != null) {
    if (dailySpend + dollars > settings.risk.maxDailySpend) {
      block(
        "maxDailySpend",
        `$${dailySpend + dollars} would exceed max daily spend $${settings.risk.maxDailySpend}.`
      );
    }
    pass("maxDailySpend", "daily spend remains within limit.");

    const currentBuyingPower = getBuyingPower({ buyingPower, portfolio });
    if (currentBuyingPower != null) {
      const projectedBuyingPower = currentBuyingPower - dollars;
      if (projectedBuyingPower < settings.risk.minBuyingPowerAfterTrade) {
        block(
          "minBuyingPowerAfterTrade",
          `projected buying power $${projectedBuyingPower.toFixed(2)} is below minimum $${settings.risk.minBuyingPowerAfterTrade}.`
        );
      }
      pass("minBuyingPowerAfterTrade", "projected buying power remains above minimum.");
    }

    const allocationPercent = getSymbolAllocationPercent({
      portfolio,
      positions,
      proposedDollars: dollars,
      symbol,
    });

    if (
      allocationPercent != null &&
      allocationPercent > settings.risk.maxPortfolioAllocationPercentPerSymbol
    ) {
      block(
        "maxPortfolioAllocationPercentPerSymbol",
        `${symbol} allocation would be ${allocationPercent.toFixed(1)}%, above max ${settings.risk.maxPortfolioAllocationPercentPerSymbol}%.`
      );
    }
    pass("maxPortfolioAllocationPercentPerSymbol", "symbol allocation is within limit or unavailable.");
  }

  if (side === "sell" && dollars != null) {
    if (dailySellAmount + dollars > settings.risk.maxDailySellAmount) {
      block(
        "maxDailySellAmount",
        `$${dailySellAmount + dollars} would exceed max daily sell amount $${settings.risk.maxDailySellAmount}.`
      );
    }
    pass("maxDailySellAmount", "daily sell amount remains within limit.");
  }

  const lastTradeDate = asDate(lastTradeAt);
  if (lastTradeDate) {
    const cooldownMs = settings.risk.cooldownMinutesAfterTrade * 60 * 1000;
    const elapsedMs = Date.now() - lastTradeDate.getTime();
    if (elapsedMs < cooldownMs) {
      block("cooldownMinutesAfterTrade", "cooldown after last trade is still active.");
    }
  }
  pass("cooldownMinutesAfterTrade", "cooldown gate satisfied.");

  return {
    ...trade,
    riskChecks: checks,
    side,
    symbol,
  };
}
