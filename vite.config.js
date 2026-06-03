import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dotenv from "dotenv";
import {
  DEFAULT_SETTINGS,
  LIVE_CONFIRMATION_TEXT,
  getSettings,
  getSettingsHealth,
  mergeSettings,
  resetSettings,
  updateSettings,
  validateSettings,
} from "./src/core/configStore.js";
import {
  disableKillSwitch,
  enableKillSwitch,
  isKillSwitchActive,
} from "./src/core/killSwitch.js";
import { logEvent } from "./src/core/ledger.js";
import { getStrategyDefinitions } from "./src/strategies/strategy.js";

dotenv.config();

const LOG_FILE = path.resolve(process.cwd(), "logs", "trades.jsonl");
let accountSnapshot = null;
let accountSyncPromise = null;
let strategyRun = null;

const sensitiveKeys = new Set([
  "access_token",
  "account_number",
  "accountnumber",
  "authorization",
  "client_secret",
  "code",
  "refresh_token",
  "token",
]);

function maskIdentifier(value) {
  const text = String(value);

  if (text.length <= 4) {
    return "masked";
  }

  return `${text.slice(0, 2)}...${text.slice(-2)}`;
}

function redact(value, key = "") {
  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");

  if (sensitiveKeys.has(normalizedKey)) {
    return maskIdentifier(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redact(childValue, childKey),
      ])
    );
  }

  if (typeof value === "string") {
    return value
      .replace(/(account_number=)([^&\s"]+)/gi, (_match, prefix, id) => {
        return `${prefix}${maskIdentifier(id)}`;
      })
      .replace(
        /("account_number"\s*:\s*")([^"]+)(")/gi,
        (_match, prefix, id, suffix) => {
          return `${prefix}${maskIdentifier(id)}${suffix}`;
        }
      );
  }

  return value;
}

function readEvents() {
  if (!fs.existsSync(LOG_FILE)) {
    return { events: [], invalidLines: 0 };
  }

  const lines = fs
    .readFileSync(LOG_FILE, "utf8")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const events = [];
  let invalidLines = 0;

  for (const line of lines) {
    try {
      events.push(redact(JSON.parse(line)));
    } catch {
      invalidLines += 1;
    }
  }

  return { events, invalidLines };
}

function readStatus() {
  const settings = getSettings();

  return {
    accountConfigured: Boolean(process.env.ROBINHOOD_ACCOUNT_NUMBER),
    allowedSymbols: settings.strategy.allowedSymbols,
    allowCrypto: settings.strategy.allowCrypto,
    allowOptions: settings.strategy.allowOptions,
    allowSells: settings.strategy.allowSells,
    confirmLiveOrder: settings.mode.confirmLiveOrder,
    dryRun: settings.mode.dryRun,
    killSwitchActive: isKillSwitchActive(),
    maxDollarsPerTrade: settings.risk.maxDollarsPerTrade,
    maxTradesPerDay: settings.risk.maxTradesPerDay,
    mcpConfigured: Boolean(process.env.ROBINHOOD_MCP_URL),
    strategy: settings.strategy.activeStrategy,
    tradingEnabled: settings.mode.tradingEnabled,
    watchSymbols: settings.strategy.watchSymbols,
  };
}

function extractTextContent(result) {
  const content = result?.content ?? [];

  return content
    .map((item) => {
      if (item.type === "text") return item.text;
      return JSON.stringify(item);
    })
    .join("\n");
}

function parseToolResult(result) {
  const text = extractTextContent(result);
  let json = null;

  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return {
    json: redact(json),
    text: redact(text),
  };
}

function uniqueSymbols(values) {
  return Array.from(
    new Set(
      values
        .flat()
        .map((value) => String(value ?? "").trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

function getPositionSymbols(parsedPositions) {
  return (
    parsedPositions?.json?.data?.positions
      ?.map((position) => position.symbol)
      .filter(Boolean) ?? []
  );
}

async function fetchAccountSnapshot() {
  const accountNumber = process.env.ROBINHOOD_ACCOUNT_NUMBER;
  const settings = getSettings();

  if (!accountNumber) {
    const error = new Error("Missing ROBINHOOD_ACCOUNT_NUMBER in .env");
    error.status = 400;
    throw error;
  }

  const { createRobinhoodMcpClient, closeRobinhoodMcpClient } = await import(
    "./src/core/mcpClient.js"
  );
  const {
    getEquityOrders,
    getEquityPositions,
    getEquityQuotes,
    getPortfolio,
  } = await import("./src/core/robinhoodTools.js");

  const client = await createRobinhoodMcpClient();

  try {
    const portfolio = parseToolResult(await getPortfolio(client, accountNumber));
    const positions = parseToolResult(await getEquityPositions(client, accountNumber));
    const symbols = uniqueSymbols([
      settings.strategy.watchSymbols,
      settings.strategy.allowedSymbols,
      getPositionSymbols(positions),
    ]).slice(0, 20);

    const quotes = symbols.length
      ? parseToolResult(await getEquityQuotes(client, symbols))
      : { json: null, text: "" };
    const recentOrders = parseToolResult(
      await getEquityOrders(client, {
        account_number: accountNumber,
        placed_agent: "agentic",
      })
    );

    return {
      account: maskIdentifier(accountNumber),
      portfolio,
      positions,
      quotes,
      recentOrders,
      symbols,
      syncedAt: new Date().toISOString(),
    };
  } finally {
    await closeRobinhoodMcpClient(client);
  }
}

function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
      }
    });

    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        const error = new Error("Request body must be valid JSON.");
        error.status = 400;
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

function sendJson(res, data, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function startStrategyRun() {
  if (strategyRun?.process && !strategyRun.exitedAt) {
    const error = new Error("A strategy run is already in progress.");
    error.status = 409;
    throw error;
  }

  const child = spawn(process.execPath, ["src/runOrder.js"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  strategyRun = {
    error: "",
    exitedAt: null,
    exitCode: null,
    output: "",
    pid: child.pid,
    process: child,
    startedAt: new Date().toISOString(),
  };

  child.stdout.on("data", (chunk) => {
    strategyRun.output += chunk.toString();
    strategyRun.output = strategyRun.output.slice(-20000);
  });

  child.stderr.on("data", (chunk) => {
    strategyRun.error += chunk.toString();
    strategyRun.error = strategyRun.error.slice(-20000);
  });

  child.on("exit", (code) => {
    strategyRun.exitCode = code;
    strategyRun.exitedAt = new Date().toISOString();
  });

  logEvent({
    type: "RUN_STRATEGY_REQUESTED",
    pid: child.pid,
  });

  return strategyRun;
}

async function handleApi(req, res, next) {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/api/ledger") {
    const { events, invalidLines } = readEvents();
    sendJson(res, {
      events,
      invalidLines,
      logFile: path.relative(process.cwd(), LOG_FILE),
      status: readStatus(),
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  if (url.pathname === "/api/settings" && req.method === "GET") {
    const settings = getSettings();
    sendJson(res, {
      defaults: DEFAULT_SETTINGS,
      health: getSettingsHealth(),
      liveConfirmationText: LIVE_CONFIRMATION_TEXT,
      settings,
      strategies: getStrategyDefinitions(),
      validation: validateSettings(settings),
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  if (url.pathname === "/api/settings" && req.method === "PATCH") {
    const body = await readRequestJson(req);
    const validation = updateSettings(body.patch ?? {}, {
      actor: "ui",
      confirmation: body.confirmation,
    });
    sendJson(res, {
      liveConfirmationText: LIVE_CONFIRMATION_TEXT,
      settings: validation.settings,
      health: getSettingsHealth(),
      strategies: getStrategyDefinitions(),
      validation,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  if (url.pathname === "/api/settings/reset" && req.method === "POST") {
    const validation = resetSettings({ actor: "ui" });
    sendJson(res, {
      settings: validation.settings,
      health: getSettingsHealth(),
      strategies: getStrategyDefinitions(),
      validation,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  if (url.pathname === "/api/settings/validate" && req.method === "POST") {
    const body = await readRequestJson(req);
    const current = getSettings();
    const settings = body.settings ?? mergeSettings(current, body.patch ?? {});
    const validation = validateSettings(settings);
    sendJson(res, {
      settings: validation.settings,
      validation,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  if (url.pathname === "/api/kill-switch/enable" && req.method === "POST") {
    enableKillSwitch();
    logEvent({ type: "KILL_SWITCH_ENABLED", actor: "ui" });
    sendJson(res, { status: readStatus(), updatedAt: new Date().toISOString() });
    return;
  }

  if (url.pathname === "/api/kill-switch/disable" && req.method === "POST") {
    disableKillSwitch();
    logEvent({ type: "KILL_SWITCH_DISABLED", actor: "ui" });
    sendJson(res, { status: readStatus(), updatedAt: new Date().toISOString() });
    return;
  }

  if (url.pathname === "/api/runtime-status") {
    sendJson(res, {
      status: readStatus(),
      strategyRun: strategyRun
        ? {
            error: strategyRun.error,
            exitedAt: strategyRun.exitedAt,
            exitCode: strategyRun.exitCode,
            output: strategyRun.output,
            pid: strategyRun.pid,
            running: !strategyRun.exitedAt,
            startedAt: strategyRun.startedAt,
          }
        : null,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  if (url.pathname === "/api/run-strategy" && req.method === "POST") {
    const run = startStrategyRun();
    sendJson(res, {
      strategyRun: {
        pid: run.pid,
        running: true,
        startedAt: run.startedAt,
      },
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  if (url.pathname === "/api/account") {
    sendJson(res, {
      snapshot: accountSnapshot,
      status: readStatus(),
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  if (url.pathname === "/api/account/sync" && req.method === "POST") {
    accountSyncPromise ??= fetchAccountSnapshot().finally(() => {
      accountSyncPromise = null;
    });

    accountSnapshot = await accountSyncPromise;

    sendJson(res, {
      snapshot: accountSnapshot,
      status: readStatus(),
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  next();
}

function localApiPlugin() {
  const handler = (req, res, next) => {
    handleApi(req, res, next).catch((err) => {
      sendJson(
        res,
        {
          error: err?.message ?? "Request failed",
          status: readStatus(),
          updatedAt: new Date().toISOString(),
        },
        err?.status ?? 500
      );
    });
  };

  return {
    name: "familiar-texture-local-api",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [react(), localApiPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
});
