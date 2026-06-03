const allowedSymbols = process.env.ALLOWED_SYMBOLS
  ? process.env.ALLOWED_SYMBOLS.split(",").map((s) => s.trim().toUpperCase())
  : [];

const maxDollarsPerTrade = Number(process.env.MAX_DOLLARS_PER_TRADE ?? 0);
const maxTradesPerDay = Number(process.env.MAX_TRADES_PER_DAY ?? 0);

const allowSells = process.env.ALLOW_SELLS === "true";
const allowOptions = process.env.ALLOW_OPTIONS === "true";
const allowCrypto = process.env.ALLOW_CRYPTO === "true";

export function validateTrade(trade, tradesToday = 0) {
  const symbol = trade.symbol?.toUpperCase();

  if (!symbol) {
    throw new Error("Blocked: missing symbol.");
  }

  if (!allowedSymbols.includes(symbol)) {
    throw new Error(`Blocked: ${symbol} is not in ALLOWED_SYMBOLS.`);
  }

  if (!["buy", "sell"].includes(trade.side)) {
    throw new Error(`Blocked: invalid side ${trade.side}.`);
  }

  if (trade.side === "sell" && !allowSells) {
    throw new Error("Blocked: selling is disabled.");
  }

  if (trade.assetType === "option" && !allowOptions) {
    throw new Error("Blocked: options are disabled.");
  }

  if (trade.assetType === "crypto" && !allowCrypto) {
    throw new Error("Blocked: crypto is disabled.");
  }

  if (!Number.isFinite(trade.dollars) || trade.dollars <= 0) {
    throw new Error("Blocked: invalid dollar amount.");
  }

  if (trade.dollars > maxDollarsPerTrade) {
    throw new Error(
      `Blocked: $${trade.dollars} exceeds max $${maxDollarsPerTrade}.`
    );
  }

  if (tradesToday >= maxTradesPerDay) {
    throw new Error("Blocked: max trades per day reached.");
  }

  return {
    ...trade,
    symbol,
  };
}
