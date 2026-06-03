import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { RobinhoodOAuthProvider } from "./auth/authProvider.js";
import { createOAuthCallbackServer } from "./auth/callbackServer.js";

const MCP_URL = process.env.ROBINHOOD_MCP_URL;

if (!MCP_URL) {
  throw new Error("Missing ROBINHOOD_MCP_URL in .env");
}

function createClient() {
  return new Client(
    {
      name: "familiar-texture",
      version: "0.1.0",
    },
    {
      capabilities: {},
    }
  );
}

function createTransport(provider) {
  return new StreamableHTTPClientTransport(new URL(MCP_URL), {
    authProvider: provider,
  });
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

  client.onerror = (err) => {
    console.error("[MCP error]", err);
  };

  client.onclose = () => {
    console.log("[MCP closed]");
  };

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

    // Recreate a fresh client/transport after tokens are saved.
    client = createClient();
    transport = createTransport(provider);

    client.onerror = (error) => {
      console.error("[MCP error]", error);
    };

    client.onclose = () => {
      console.log("[MCP closed]");
    };

    await client.connect(transport);

    return client;
  }
}