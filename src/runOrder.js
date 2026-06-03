import { createRobinhoodMcpClient } from "./core/mcpClient.js";
import {
  getPortfolio,
  getEquityPositions,
  getEquityOrders,
  getEquityQuotes,
  getEquityTradability,
  placeEquityOrder,
  reviewEquityOrder,
} from "./core/robinhoodTools.js";
import { getTradeIdea } from "./strategies/strategy.js";
import { assertLiveOrderAllowed, validateTrade } from "./core/risk.js";
import { getSettings } from "./core/configStore.js";
import { logEvent } from "./core/ledger.js";
import { assertKillSwitchOff } from "./core/killSwitch.js";

const ACCOUNT_NUMBER = process.env.ROBINHOOD_ACCOUNT_NUMBER;

function extractTextContent(result) {
  const content = result?.content ?? [];

  return content
    .map((item) => {
      if (item.type === "text") return item.text;
      return JSON.stringify(item);
    })
    .join("\n");
}

function parseTextJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function getOrderDollarAmount(order) {
  const amount =
    order?.dollar_based_amount?.amount ??
    order?.dollar_amount ??
    order?.notional ??
    null;
  const number = Number(amount);
  return Number.isFinite(number) ? number : 0;
}

function summarizeTodayOrders(parsedOrders) {
  const orders = parsedOrders?.data?.orders ?? [];
  const today = new Date().toISOString().slice(0, 10);
  let dailySellAmount = 0;
  let dailySpend = 0;
  let lastTradeAt = null;
  let tradesToday = 0;

  for (const order of orders) {
    const orderDate = parseDate(order.last_transaction_at ?? order.created_at);
    if (!orderDate) continue;

    if (!lastTradeAt || orderDate > lastTradeAt) {
      lastTradeAt = orderDate;
    }

    if (orderDate.toISOString().slice(0, 10) !== today) {
      continue;
    }

    tradesToday += 1;

    if (order.side === "buy") {
      dailySpend += getOrderDollarAmount(order);
    } else if (order.side === "sell") {
      dailySellAmount += getOrderDollarAmount(order);
    }
  }

  return {
    dailySellAmount,
    dailySpend,
    lastTradeAt: lastTradeAt?.toISOString() ?? null,
    tradesToday,
  };
}

async function safeClose(client) {
  const originalConsoleError = console.error;

  try {
    console.error = (...args) => {
      const text = args.map(String).join(" ");

      if (
        text.includes("SSE stream disconnected") ||
        text.includes("This operation was aborted")
      ) {
        return;
      }

      originalConsoleError(...args);
    };

    await client.close();
  } catch (err) {
    const message = String(err?.message ?? err);

    if (
      message.includes("SSE stream disconnected") ||
      message.includes("This operation was aborted")
    ) {
      return;
    }

    throw err;
  } finally {
    setTimeout(() => {
      console.error = originalConsoleError;
    }, 250);
  }
}

function buildEquityOrder({ accountNumber, approvedTrade }) {
  if (approvedTrade.assetType !== "equity") {
    throw new Error(`Unsupported assetType: ${approvedTrade.assetType}`);
  }

  const order = {
    account_number: accountNumber,
    market_hours: approvedTrade.marketHours ?? "regular_hours",
    side: approvedTrade.side,
    symbol: approvedTrade.symbol,
    time_in_force: approvedTrade.timeInForce ?? "gfd",
    type: approvedTrade.orderType ?? "market",
  };

  if (approvedTrade.quantity != null) {
    order.quantity = String(approvedTrade.quantity);
  } else {
    order.dollar_amount = Number(approvedTrade.dollars).toFixed(2);
  }

  if (approvedTrade.limitPrice != null) {
    order.limit_price = String(approvedTrade.limitPrice);
  }

  if (approvedTrade.stopPrice != null) {
    order.stop_price = String(approvedTrade.stopPrice);
  }

  return order;
}

async function main() {
  const settings = getSettings();

  assertKillSwitchOff();

  if (!ACCOUNT_NUMBER) {
    throw new Error(
      "Missing ROBINHOOD_ACCOUNT_NUMBER in .env. Run npm run accounts first, choose the agentic_allowed=true account, and add it to .env."
    );
  }

  const client = await createRobinhoodMcpClient();

  try {
    console.log("\nFetching account/market context...");

    const portfolio = await getPortfolio(client, ACCOUNT_NUMBER);
    const positions = await getEquityPositions(client, ACCOUNT_NUMBER);
    const quotes = await getEquityQuotes(client, settings.strategy.watchSymbols);
    const recentOrders = await getEquityOrders(client, {
      account_number: ACCOUNT_NUMBER,
      placed_agent: "agentic",
    });

    const portfolioText = extractTextContent(portfolio);
    const positionsText = extractTextContent(positions);
    const quotesText = extractTextContent(quotes);
    const recentOrdersText = extractTextContent(recentOrders);
    const parsedPortfolio = parseTextJson(portfolioText);
    const parsedPositions = parseTextJson(positionsText);
    const parsedQuotes = parseTextJson(quotesText);
    const parsedOrders = parseTextJson(recentOrdersText);
    const todaySummary = summarizeTodayOrders(parsedOrders);

    logEvent({
      type: "STRATEGY_INPUTS",
      parsedOrders,
      parsedPortfolio,
      parsedPositions,
      parsedQuotes,
      portfolioText,
      positionsText,
      quotesText,
      recentOrdersText,
      settings,
      watchSymbols: settings.strategy.watchSymbols,
    });

    const rawDecision = await getTradeIdea({
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

    console.log("\nStrategy decision:");
    console.log(rawDecision);

    logEvent({
      type: "STRATEGY_DECISION",
      decision: rawDecision,
      strategy: settings.strategy.activeStrategy,
    });

    if (rawDecision.action === "hold") {
      console.log("\nNo trade proposed.");
      console.log("Reason:", rawDecision.reason);

      logEvent({
        type: "STRATEGY_HOLD",
        reason: rawDecision.reason,
      });

      await safeClose(client);
      return;
    }

    if (rawDecision.action !== "trade") {
      throw new Error(`Invalid strategy action: ${rawDecision.action}`);
    }

    const approvedTrade = validateTrade(rawDecision, {
      buyingPower: parsedPortfolio?.data?.buying_power?.buying_power,
      dailySellAmount: todaySummary.dailySellAmount,
      dailySpend: todaySummary.dailySpend,
      lastTradeAt: todaySummary.lastTradeAt,
      portfolio: parsedPortfolio?.data,
      positions: parsedPositions?.data?.positions ?? [],
      settings,
      tradesToday: todaySummary.tradesToday,
    });

    const order = buildEquityOrder({
      accountNumber: ACCOUNT_NUMBER,
      approvedTrade,
    });

    logEvent({
      type: "LOCAL_TRADE_APPROVED",
      order,
      riskChecks: approvedTrade.riskChecks,
      trade: approvedTrade,
    });

    const tradability = await getEquityTradability(client, ACCOUNT_NUMBER, [
      approvedTrade.symbol,
    ]);
    const tradabilityText = extractTextContent(tradability);

    logEvent({
      type: "TRADABILITY_CHECK",
      symbol: approvedTrade.symbol,
      tradabilityText,
    });

    assertKillSwitchOff();

    const review = await reviewEquityOrder(client, order);
    const reviewedOrderSignature = JSON.stringify(order);
    const reviewText = extractTextContent(review);

    console.log("\nOrder review result:\n");
    console.log(reviewText);

    logEvent({
      type: "ORDER_REVIEW",
      order,
      reviewText,
      riskChecks: approvedTrade.riskChecks,
    });

    if (
      settings.mode.dryRun ||
      !settings.mode.tradingEnabled ||
      !settings.mode.confirmLiveOrder ||
      settings.risk.requireManualConfirmationForLive
    ) {
      console.log("\nNo live order placed.");
      console.log(settings.mode);

      logEvent({
        type: "ORDER_REVIEWED_BUT_NOT_PLACED",
        confirmLiveOrder: settings.mode.confirmLiveOrder,
        dryRun: settings.mode.dryRun,
        manualConfirmationRequired: settings.risk.requireManualConfirmationForLive,
        order,
        tradingEnabled: settings.mode.tradingEnabled,
      });

      await safeClose(client);
      return;
    }

    assertKillSwitchOff();
    if (JSON.stringify(order) !== reviewedOrderSignature) {
      throw new Error("Blocked: order changed after broker review.");
    }

    assertLiveOrderAllowed(settings);

    const placement = await placeEquityOrder(client, order);
    const placementText = extractTextContent(placement);

    console.log("\nLIVE ORDER PLACED:\n");
    console.log(placementText);

    logEvent({
      type: "LIVE_ORDER_PLACED",
      order,
      placementText,
    });

    await safeClose(client);
  } catch (err) {
    await safeClose(client);
    throw err;
  }
}

main().catch((err) => {
  logEvent({
    type: "RUN_ORDER_ERROR",
    message: err.message,
    riskChecks: err.riskChecks,
    stack: err.stack,
  });

  console.error(err);
  process.exit(1);
});
