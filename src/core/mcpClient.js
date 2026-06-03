import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { RobinhoodOAuthProvider } from "../auth/authProvider.js";
import { createOAuthCallbackServer } from "../auth/callbackServer.js";

const MCP_URL = process.env.ROBINHOOD_MCP_URL;

if (!MCP_URL) {
  throw new Error("Missing ROBINHOOD_MCP_URL in .env");
}

function isBenignStreamCloseError(err) {
  const message = String(err?.message ?? err);

  return (
    message.includes("SSE stream disconnected") ||
    message.includes("This operation was aborted") ||
    message.includes("AbortError")
  );
}

function createClient() {
  const client = new Client(
    {
      name: "familiar-texture",
      version: "0.1.0",
    },
    {
      capabilities: {},
    }
  );

  client.onerror = (err) => {
    if (isBenignStreamCloseError(err)) {
      return;
    }

    console.error("[MCP error]", err);
  };

  client.onclose = () => {
    console.log("[MCP closed]");
  };

  return client;
}

function createTransport(provider) {
  return new StreamableHTTPClientTransport(new URL(MCP_URL), {
    authProvider: provider,
  });
}

export async function closeRobinhoodMcpClient(client) {
  try {
    await client.close();
  } catch (err) {
    if (isBenignStreamCloseError(err)) {
      return;
    }

    throw err;
  }
}

export async function createRobinhoodMcpClient() {
  const callbackServer = await createOAuthCallbackServer({
    port: 59291,
    path: "/callback",
  }).start();

  const provider = new RobinhoodOAuthProvider({
    redirectUrl: callbackServer.redirectUrl,
  });

  let client = createClient();
  let transport = createTransport(provider);

  try {
    await client.connect(transport);
    await callbackServer.close();
    return client;
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) {
      await callbackServer.close();
      throw err;
    }

    console.log("Robinhood MCP requires authorization.");
    console.log("Waiting for browser authorization callback...");

    const code = await callbackServer.waitForCode();

    console.log("Authorization code received. Finishing OAuth...");

    await transport.finishAuth(code);

    await callbackServer.close();

    client = createClient();
    transport = createTransport(provider);

    await client.connect(transport);

    return client;
  }
}
