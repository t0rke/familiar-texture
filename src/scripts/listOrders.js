import "dotenv/config";
import {
  createRobinhoodMcpClient,
  closeRobinhoodMcpClient,
} from "../core/mcpClient.js";
import { getEquityOrders } from "../core/robinhoodTools.js";

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
  try {
    await closeRobinhoodMcpClient(client);
  } catch {
    // Ignore MCP stream-close noise.
  }
}

async function main() {
  if (!ACCOUNT_NUMBER) {
    throw new Error("Missing ROBINHOOD_ACCOUNT_NUMBER in .env");
  }

  const client = await createRobinhoodMcpClient();

  const result = await getEquityOrders(client, {
    account_number: ACCOUNT_NUMBER,

    // Optional filters:
    // symbol: "VOO",
    // state: "filled",
    // placed_agent: "agentic",
  });

  console.log("\nRecent equity orders:\n");
  console.log(extractTextContent(result));

  await closeRobinhoodMcpClient(client);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
