import "dotenv/config";
import { createRobinhoodMcpClient } from "./mcpClient.js";
import {
  getAccounts,
  getPortfolio,
  getEquityTradability,
  reviewEquityOrder,
  placeEquityOrder,
} from "./robinhoodTools.js";
import { validateTrade } from "./risk.js";
import { logEvent } from "./ledger.js";
import { assertKillSwitchOff } from "./killSwitch.js";

const DRY_RUN = process.env.DRY_RUN === "true";
const TRADING_ENABLED = process.env.TRADING_ENABLED === "true";
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

async function main() {
  assertKillSwitchOff();

  if (!ACCOUNT_NUMBER) {
    throw new Error(
      "Missing ROBINHOOD_ACCOUNT_NUMBER in .env. Run get_accounts first, choose the agentic_allowed=true account, and add it to .env."
    );
  }

  const rawTrade = {
    symbol: "VOO",
    side: "buy",
    dollars: 1,
    assetType: "equity",
    reason: "Tiny test order through Node MCP client.",
  };

  const approvedTrade = validateTrade(rawTrade, 0);

  const order = {
    account_number: ACCOUNT_NUMBER,
    symbol: approvedTrade.symbol,
    side: approvedTrade.side,
    type: "market",
    dollar_amount: approvedTrade.dollars.toFixed(2),
    time_in_force: "gfd",
    market_hours: "regular_hours",
  };

  logEvent({
    type: "LOCAL_TRADE_APPROVED",
    trade: approvedTrade,
    order,
  });

  const client = await createRobinhoodMcpClient();

  const portfolio = await getPortfolio(client, ACCOUNT_NUMBER);

  logEvent({
    type: "PORTFOLIO_CHECK",
    portfolioText: extractTextContent(portfolio),
  });

  const tradability = await getEquityTradability(client, ACCOUNT_NUMBER, [
    approvedTrade.symbol,
  ]);

  logEvent({
    type: "TRADABILITY_CHECK",
    tradabilityText: extractTextContent(tradability),
  });

  const review = await reviewEquityOrder(client, order);

  console.log("\nOrder review result:\n");
  console.log(extractTextContent(review));

  logEvent({
    type: "ORDER_REVIEW",
    order,
    reviewText: extractTextContent(review),
  });

  if (DRY_RUN || !TRADING_ENABLED) {
    console.log("\nNo live order placed.");
    console.log({ DRY_RUN, TRADING_ENABLED });

    logEvent({
      type: "DRY_RUN_ORDER_NOT_PLACED",
      order,
      dryRun: DRY_RUN,
      tradingEnabled: TRADING_ENABLED,
    });

    await safeClose(client);
    return;
  }

  const placement = await placeEquityOrder(client, order);

  console.log("\nLIVE ORDER PLACED:\n");
  console.log(extractTextContent(placement));

  logEvent({
    type: "LIVE_ORDER_PLACED",
    order,
    placementText: extractTextContent(placement),
  });

  await safeClose(client);
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