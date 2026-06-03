import { createRobinhoodMcpClient } from "../core/mcpClient.js";

async function safeClose(client) {
  try {
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
  }
}

async function main() {
  const client = await createRobinhoodMcpClient();

  const tools = await client.listTools();

  console.log("\nAvailable Robinhood MCP tools:\n");

  for (const tool of tools.tools ?? []) {
    console.log("=".repeat(80));
    console.log("Name:", tool.name);
    console.log("Description:", tool.description);
    console.log("Input schema:");
    console.dir(tool.inputSchema, { depth: null });
  }

  await safeClose(client);
}

main().catch((err) => {
  const message = String(err?.message ?? err);

  if (
    message.includes("SSE stream disconnected") ||
    message.includes("This operation was aborted")
  ) {
    process.exit(0);
  }

  console.error(err);
  process.exit(1);
});
