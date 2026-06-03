function safeIncludes(text, value) {
  return String(text ?? "").toUpperCase().includes(String(value).toUpperCase());
}

/**
 * This is your strategy layer.
 *
 * It should return one of:
 *
 * HOLD:
 * {
 *   action: "hold",
 *   reason: "..."
 * }
 *
 * TRADE:
 * {
 *   action: "trade",
 *   symbol: "VOO",
 *   side: "buy",
 *   dollars: 1,
 *   assetType: "equity",
 *   reason: "..."
 * }
 */
export async function getTradeIdea({
  portfolioText,
  positionsText,
  quotesText,
  recentOrdersText,
}) {
  const strategy = process.env.STRATEGY ?? "starter_voo";

  if (strategy === "starter_voo") {
    return starterVOOStrategy({
      portfolioText,
      positionsText,
      quotesText,
      recentOrdersText,
    });
  }

  if (strategy === "always_buy_voo_test") {
    return {
      action: "trade",
      symbol: "VOO",
      side: "buy",
      dollars: 1,
      assetType: "equity",
      reason: "Test strategy: always propose a tiny $1 VOO buy.",
    };
  }

  throw new Error(`Unknown STRATEGY: ${strategy}`);
}

function starterVOOStrategy({ positionsText, recentOrdersText }) {
  const alreadyOwnsVOO = safeIncludes(positionsText, "VOO");

  if (alreadyOwnsVOO) {
    return {
      action: "hold",
      reason: "Starter strategy: already holding VOO, so no new buy is needed.",
    };
  }

  const recentlyBoughtVOO =
    safeIncludes(recentOrdersText, "VOO") &&
    safeIncludes(recentOrdersText, "buy");

  if (recentlyBoughtVOO) {
    return {
      action: "hold",
      reason:
        "Starter strategy: recent VOO buy detected in order history, so no duplicate order.",
    };
  }

  return {
    action: "trade",
    symbol: "VOO",
    side: "buy",
    dollars: 1,
    assetType: "equity",
    reason: "Starter strategy: no VOO position detected, so buy $1 of VOO.",
  };
}
