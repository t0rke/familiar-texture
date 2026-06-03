import {
    createRobinhoodMcpClient,
    closeRobinhoodMcpClient,
} from "./core/mcpClient.js";
import {
  getPortfolio,
    getEquityPositions,
    getEquityQuotes,
    getEquityOrders,
  getEquityTradability,
  reviewEquityOrder,
  placeEquityOrder,
} from "./core/robinhoodTools.js";
import { getTradeIdea } from "./strategies/strategy.js";
import { validateTrade } from "./core/risk.js";
import { logEvent } from "./core/ledger.js";
import { assertKillSwitchOff } from "./core/killSwitch.js";

const DRY_RUN = process.env.DRY_RUN === "true";
const TRADING_ENABLED = process.env.TRADING_ENABLED === "true";
const CONFIRM_LIVE_ORDER =
    process.env.CONFIRM_LIVE_ORDER === "YES_I_UNDERSTAND_THIS_PLACES_REAL_ORDERS";

const ACCOUNT_NUMBER = process.env.ROBINHOOD_ACCOUNT_NUMBER;

const WATCH_SYMBOLS = process.env.WATCH_SYMBOLS
    ? process.env.WATCH_SYMBOLS.split(",").map((s) => s.trim().toUpperCase())
    : ["VOO"];

function extractTextContent(result) {
  const content = result?.content ?? [];

  return content
    .map((item) => {
      if (item.type === "text") return item.text;
      return JSON.stringify(item);
    })
    .join("\n");
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
        symbol: approvedTrade.symbol,
        side: approvedTrade.side,
        type: approvedTrade.orderType ?? "market",
        time_in_force: approvedTrade.timeInForce ?? "gfd",
        market_hours: approvedTrade.marketHours ?? "regular_hours",
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
        const quotes = await getEquityQuotes(client, WATCH_SYMBOLS);
        const recentOrders = await getEquityOrders(client, {
            account_number: ACCOUNT_NUMBER,
            placed_agent: "agentic",
        });

        const portfolioText = extractTextContent(portfolio);
        const positionsText = extractTextContent(positions);
        const quotesText = extractTextContent(quotes);
        const recentOrdersText = extractTextContent(recentOrders);

        logEvent({
            type: "STRATEGY_INPUTS",
            watchSymbols: WATCH_SYMBOLS,
            portfolioText,
            positionsText,
            quotesText,
            recentOrdersText,
        });

        const rawDecision = await getTradeIdea({
            portfolioText,
            positionsText,
            quotesText,
            recentOrdersText,
        });

        console.log("\nStrategy decision:");
        console.log(rawDecision);

        logEvent({
            type: "STRATEGY_DECISION",
            decision: rawDecision,
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

        const tradesToday = 0;
        const approvedTrade = validateTrade(rawDecision, tradesToday);

        const order = buildEquityOrder({
            accountNumber: ACCOUNT_NUMBER,
            approvedTrade,
        });

        logEvent({
            type: "LOCAL_TRADE_APPROVED",
            trade: approvedTrade,
            order,
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

        const review = await reviewEquityOrder(client, order);
        const reviewText = extractTextContent(review);

        console.log("\nOrder review result:\n");
        console.log(reviewText);

        logEvent({
            type: "ORDER_REVIEW",
            order,
            reviewText,
        });

        if (DRY_RUN || !TRADING_ENABLED || !CONFIRM_LIVE_ORDER) {
            console.log("\nNo live order placed.");
            console.log({
                DRY_RUN,
                TRADING_ENABLED,
                CONFIRM_LIVE_ORDER,
            });

            logEvent({
                type: "ORDER_REVIEWED_BUT_NOT_PLACED",
                order,
                dryRun: DRY_RUN,
                tradingEnabled: TRADING_ENABLED,
                confirmLiveOrder: CONFIRM_LIVE_ORDER,
            });

            await safeClose(client);
            return;
        }

        assertKillSwitchOff();

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
    stack: err.stack,
  });

  console.error(err);
  process.exit(1);
});
