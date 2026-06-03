import { createRobinhoodMcpClient } from "./mcpClient.js";
import { getAccounts } from "./robinhoodTools.js";

function extractTextContent(result) {
  const content = result?.content ?? [];

  return content
    .map((item) => {
      if (item.type === "text") return item.text;
      return JSON.stringify(item);
    })
    .join("\n");
}

async function main() {
  const client = await createRobinhoodMcpClient();

  const accounts = await getAccounts(client);

  console.log(extractTextContent(accounts));

  try {
    await client.close();
  } catch {
    // ignore close noise
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});