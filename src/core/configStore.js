import fs from "fs";
import path from "path";
import { prisma } from "./db.js";
import { logEvent } from "./ledger.js";

export const SETTINGS_FILE = path.join("data", "settings.json");
export const LIVE_CONFIRMATION_TEXT = "ENABLE LIVE TRADING";

export const STRATEGY_DEFINITIONS = {
  aaoi_dip_reversal:
    "AAOI dip-reversal: buy only after intraday candle evidence of selling exhaustion, buyer absorption, and nearby invalidation.",
  starter_voo:
    "Starter VOO guard: hold when VOO is already owned, otherwise buy a tiny VOO starter position.",
  fixed_dca:
    "Fixed DCA: buy a fixed dollar amount of each watched symbol when risk checks allow it.",
  dip_buyer:
    "Dip buyer: buy watched symbols only when their live quote is below the configured threshold.",
  rebalance:
    "Rebalance: suggest buys or sells when holdings drift beyond the configured allocation threshold.",
  manual_signal:
    "Manual signal: only act on a user-created trade proposal, still subject to risk checks.",
};

export const DEFAULT_SETTINGS = {
  marketData: {
    experimentalScrapingEnabled: false,
    interval: "1",
    lookbackMinutes: 180,
    marketConfirmationSymbol: "QQQ",
    maxCandleAgeSeconds: 90,
    maxQuoteMismatchPercent: 0.75,
    providerPriority: ["finnhub", "twelveData", "robinhoodQuoteOnly"],
  },
  mode: {
    dryRun: true,
    tradingEnabled: false,
    confirmLiveOrder: false,
  },
  strategy: {
    activeStrategy: "aaoi_dip_reversal",
    watchSymbols: ["AAOI", "QQQ", "SPY"],
    allowedSymbols: ["AAOI"],
    blockedSymbols: [],
    allowBuys: true,
    allowSells: false,
    allowOptions: false,
    allowCrypto: false,
    fixedDcaAmount: 1,
    rebalanceTargets: {},
    manualSignal: null,
  },
  risk: {
    maxDollarsPerTrade: 1,
    maxTradesPerDay: 1,
    maxPortfolioAllocationPercentPerSymbol: 20,
    maxCashUsagePercentPerRun: 20,
    minBuyingPowerAfterTrade: 1,
    maxDailySpend: 5,
    maxDailySellAmount: 0,
    cooldownMinutesAfterTrade: 30,
    requireReviewBeforePlace: true,
    requireManualConfirmationForLive: true,
  },
  modelTuning: {
    riskTolerance: 0.15,
    cashReservePercent: 25,
    dipBuyThresholdPercent: 1.5,
    takeProfitPercent: 8,
    stopLossPercent: 5,
    rebalanceThresholdPercent: 10,
    positionSizingMode: "fixed_dollars",
    confidenceThreshold: 0.75,
    maxSignalAgeMinutes: 30,
  },
  strategyParams: {
    aaoi_dip_reversal: {
      atrPeriod: 14,
      atrStopMultiplier: 1,
      defaultDollars: 1,
      hardMaxLossPercent: 1,
      macdFast: 12,
      macdSignal: 9,
      macdSlow: 26,
      minCandles: 35,
      minRewardRisk: 1.5,
      minScoreToTrade: 7,
      rsiOversold: 30,
      rsiPeriod: 14,
      rsiRecovery: 35,
      stopBufferPercent: 0.05,
      symbol: "AAOI",
      targetMode: "vwap_or_2r",
      volumeAveragePeriod: 10,
    },
  },
  ui: {
    refreshIntervalSeconds: 60,
    theme: "system",
    compactMode: false,
  },
};

let lastSettingsError = null;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isPlainObject(base)) {
    return structuredClone(override ?? base);
  }

  const output = structuredClone(base);

  for (const [key, value] of Object.entries(override ?? {})) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = deepMerge(output[key], value);
    } else if (value !== undefined) {
      output[key] = value;
    }
  }

  return output;
}

export function mergeSettings(base, patch) {
  return deepMerge(base, patch);
}

function ensureSettingsDir() {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
}

function atomicWriteJson(file, value) {
  ensureSettingsDir();

  const tmpFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmpFile, file);
}

function normalizeSymbol(value) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeSymbols(values) {
  return Array.from(
    new Set((Array.isArray(values) ? values : []).map(normalizeSymbol).filter(Boolean))
  );
}

function normalizeSettings(settings) {
  const normalized = deepMerge(DEFAULT_SETTINGS, settings);

  normalized.strategy.watchSymbols = normalizeSymbols(normalized.strategy.watchSymbols);
  normalized.strategy.allowedSymbols = normalizeSymbols(normalized.strategy.allowedSymbols);
  normalized.strategy.blockedSymbols = normalizeSymbols(normalized.strategy.blockedSymbols);
  normalized.marketData.providerPriority = Array.isArray(
    normalized.marketData.providerPriority
  )
    ? normalized.marketData.providerPriority
    : DEFAULT_SETTINGS.marketData.providerPriority;

  return normalized;
}

function addRangeError(errors, settings, pathName, min, max) {
  const value = pathName.split(".").reduce((object, key) => object?.[key], settings);

  if (!Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max) {
    errors.push(`${pathName} must be between ${min} and ${max}.`);
  }
}

function validateSymbolList(errors, values, pathName) {
  for (const symbol of values) {
    if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) {
      errors.push(`${pathName} contains invalid symbol "${symbol}".`);
    }
  }
}

export function validateSettings(settings) {
  const normalized = normalizeSettings(settings);
  const errors = [];
  const warnings = [];

  if (!STRATEGY_DEFINITIONS[normalized.strategy.activeStrategy]) {
    errors.push(`Unknown strategy: ${normalized.strategy.activeStrategy}.`);
  }

  validateSymbolList(errors, normalized.strategy.watchSymbols, "strategy.watchSymbols");
  validateSymbolList(errors, normalized.strategy.allowedSymbols, "strategy.allowedSymbols");
  validateSymbolList(errors, normalized.strategy.blockedSymbols, "strategy.blockedSymbols");

  for (const symbol of normalized.strategy.blockedSymbols) {
    if (normalized.strategy.allowedSymbols.includes(symbol)) {
      errors.push(`${symbol} cannot be both allowed and blocked.`);
    }
  }

  addRangeError(errors, normalized, "strategy.fixedDcaAmount", 0.01, 100000);
  addRangeError(errors, normalized, "risk.maxDollarsPerTrade", 0.01, 100000);
  addRangeError(errors, normalized, "risk.maxTradesPerDay", 0, 1000);
  addRangeError(errors, normalized, "risk.maxPortfolioAllocationPercentPerSymbol", 0, 100);
  addRangeError(errors, normalized, "risk.maxCashUsagePercentPerRun", 0, 100);
  addRangeError(errors, normalized, "risk.minBuyingPowerAfterTrade", 0, 1000000);
  addRangeError(errors, normalized, "risk.maxDailySpend", 0, 1000000);
  addRangeError(errors, normalized, "risk.maxDailySellAmount", 0, 1000000);
  addRangeError(errors, normalized, "risk.cooldownMinutesAfterTrade", 0, 10080);
  addRangeError(errors, normalized, "modelTuning.riskTolerance", 0, 1);
  addRangeError(errors, normalized, "modelTuning.cashReservePercent", 0, 100);
  addRangeError(errors, normalized, "modelTuning.dipBuyThresholdPercent", 0, 50);
  addRangeError(errors, normalized, "modelTuning.takeProfitPercent", 0, 500);
  addRangeError(errors, normalized, "modelTuning.stopLossPercent", 0, 100);
  addRangeError(errors, normalized, "modelTuning.rebalanceThresholdPercent", 0, 100);
  addRangeError(errors, normalized, "modelTuning.confidenceThreshold", 0, 1);
  addRangeError(errors, normalized, "modelTuning.maxSignalAgeMinutes", 0, 10080);
  addRangeError(errors, normalized, "marketData.lookbackMinutes", 1, 1440);
  addRangeError(errors, normalized, "marketData.maxCandleAgeSeconds", 15, 3600);
  addRangeError(errors, normalized, "marketData.maxQuoteMismatchPercent", 0, 25);
  addRangeError(errors, normalized, "ui.refreshIntervalSeconds", 5, 3600);

  if (
    ![
      "fixed_dollars",
      "percent_of_buying_power",
      "volatility_adjusted",
      "equal_weight",
    ].includes(normalized.modelTuning.positionSizingMode)
  ) {
    errors.push("modelTuning.positionSizingMode is invalid.");
  }

  if (!["system", "light", "dark"].includes(normalized.ui.theme)) {
    errors.push("ui.theme is invalid.");
  }

  if (!normalized.strategy.allowBuys && !normalized.strategy.allowSells) {
    warnings.push("Both buys and sells are disabled; strategies can only hold.");
  }

  if (normalized.strategy.allowOptions) {
    warnings.push("Options are enabled. This is advanced and remains blocked by default.");
  }

  if (normalized.strategy.allowCrypto) {
    warnings.push("Crypto is enabled. This is advanced and remains blocked by default.");
  }

  if (normalized.marketData.experimentalScrapingEnabled) {
    warnings.push("Experimental market data scraping is not live-safe.");
  }

  if (normalized.mode.tradingEnabled || !normalized.mode.dryRun || normalized.mode.confirmLiveOrder) {
    if (normalized.mode.dryRun) {
      warnings.push("Live gates are partly enabled, but dry run still prevents order placement.");
    }

    if (normalized.mode.tradingEnabled && !normalized.mode.confirmLiveOrder) {
      errors.push("Live trading requires confirmLiveOrder=true.");
    }

    if (!normalized.mode.dryRun && !normalized.mode.tradingEnabled) {
      errors.push("dryRun=false requires tradingEnabled=true.");
    }

    if (!normalized.risk.requireReviewBeforePlace) {
      errors.push("requireReviewBeforePlace must remain true.");
    }
  }

  return {
    errors,
    settings: normalized,
    valid: errors.length === 0,
    warnings,
  };
}

function readLegacySettings() {
  ensureSettingsDir();

  if (!fs.existsSync(SETTINGS_FILE)) {
    atomicWriteJson(SETTINGS_FILE, DEFAULT_SETTINGS);
    return structuredClone(DEFAULT_SETTINGS);
  }

  const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  const validation = validateSettings(parsed);

  if (!validation.valid) {
    throw new Error(validation.errors.join(" "));
  }

  if (JSON.stringify(parsed) !== JSON.stringify(validation.settings)) {
    atomicWriteJson(SETTINGS_FILE, validation.settings);
  }

  return validation.settings;
}

async function writeAudit(action, { actor = "local-user", afterJson, beforeJson, entityId, entityType, metadataJson } = {}) {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        actor,
        afterJson,
        beforeJson,
        entityId,
        entityType,
        metadataJson,
      },
    });
  } catch (err) {
    lastSettingsError = {
      message: `Audit DB write failed: ${err.message}`,
      recoveredAt: new Date().toISOString(),
    };
  }
}

async function getDbSettings() {
  const row = await prisma.appSetting.findUnique({
    where: {
      key: "settings",
    },
  });

  if (!row) return null;

  return row.valueJson;
}

async function setDbSettings(settings) {
  await prisma.appSetting.upsert({
    create: {
      key: "settings",
      valueJson: settings,
    },
    update: {
      valueJson: settings,
    },
    where: {
      key: "settings",
    },
  });
}

export async function getSettings() {
  try {
    const dbSettings = await getDbSettings();
    const source = dbSettings ?? readLegacySettings();
    const validation = validateSettings(source);

    if (!validation.valid) {
      lastSettingsError = {
        message: validation.errors.join(" "),
        recoveredAt: new Date().toISOString(),
      };
      return structuredClone(DEFAULT_SETTINGS);
    }

    if (!dbSettings) {
      await setDbSettings(validation.settings);
      await writeAudit("LEGACY_SETTINGS_IMPORTED", {
        afterJson: validation.settings,
        entityType: "AppSetting",
        metadataJson: {
          source: SETTINGS_FILE,
        },
      });
    }

    lastSettingsError = null;
    return validation.settings;
  } catch (err) {
    try {
      const legacy = readLegacySettings();
      lastSettingsError = {
        message: `DB unavailable, using legacy settings: ${err.message}`,
        recoveredAt: new Date().toISOString(),
      };
      return legacy;
    } catch (legacyErr) {
      lastSettingsError = {
        message: `Settings unavailable, using safe defaults: ${legacyErr.message}`,
        recoveredAt: new Date().toISOString(),
      };
      return structuredClone(DEFAULT_SETTINGS);
    }
  }
}

export function getSettingsHealth() {
  return {
    exists: fs.existsSync(SETTINGS_FILE),
    file: SETTINGS_FILE,
    lastError: lastSettingsError,
    ok: !lastSettingsError,
    source: lastSettingsError ? "fallback" : "database",
  };
}

export async function updateSettings(patch, options = {}) {
  const current = await getSettings();
  const proposed = deepMerge(current, patch);
  const enablingLive =
    proposed.mode.tradingEnabled &&
    !proposed.mode.dryRun &&
    proposed.mode.confirmLiveOrder &&
    (!current.mode.tradingEnabled || current.mode.dryRun || !current.mode.confirmLiveOrder);

  if (enablingLive && options.confirmation !== LIVE_CONFIRMATION_TEXT) {
    const error = new Error(`Live trading requires typing "${LIVE_CONFIRMATION_TEXT}".`);
    error.status = 400;
    throw error;
  }

  const validation = validateSettings(proposed);

  if (!validation.valid) {
    const error = new Error(validation.errors.join(" "));
    error.status = 400;
    error.validation = validation;
    throw error;
  }

  await setDbSettings(validation.settings);
  atomicWriteJson(SETTINGS_FILE, validation.settings);

  logEvent({
    type: "SETTINGS_UPDATED",
    actor: options.actor ?? "ui",
    patch,
    warnings: validation.warnings,
  });

  await writeAudit("SETTINGS_UPDATED", {
    actor: options.actor ?? "ui",
    afterJson: validation.settings,
    beforeJson: current,
    entityType: "AppSetting",
    metadataJson: {
      warnings: validation.warnings,
    },
  });

  return validation;
}

export async function resetSettings(options = {}) {
  const current = await getSettings();
  const validation = validateSettings(DEFAULT_SETTINGS);

  await setDbSettings(validation.settings);
  atomicWriteJson(SETTINGS_FILE, validation.settings);

  logEvent({
    type: "SETTINGS_RESET",
    actor: options.actor ?? "ui",
  });

  await writeAudit("SETTINGS_RESET", {
    actor: options.actor ?? "ui",
    afterJson: validation.settings,
    beforeJson: current,
    entityType: "AppSetting",
  });

  return validation;
}

export async function getActiveRiskProfile() {
  const settings = await getSettings();

  try {
    const profile = await prisma.riskProfile.findFirst({
      where: {
        isActive: true,
      },
    });

    return profile ?? settings.risk;
  } catch {
    return settings.risk;
  }
}

export async function updateRiskProfile(patch, options = {}) {
  return updateSettings({ risk: patch }, options);
}

export async function getActiveStrategyConfig() {
  const settings = await getSettings();

  try {
    const config = await prisma.strategyConfig.findFirst({
      where: {
        isActive: true,
      },
    });

    return config ?? {
      paramsJson: settings.strategyParams[settings.strategy.activeStrategy] ?? {},
      strategyKey: settings.strategy.activeStrategy,
    };
  } catch {
    return {
      paramsJson: settings.strategyParams[settings.strategy.activeStrategy] ?? {},
      strategyKey: settings.strategy.activeStrategy,
    };
  }
}

export async function updateStrategyConfig(patch, options = {}) {
  return updateSettings(
    {
      modelTuning: patch.modelTuning ?? patch,
      strategyParams: patch.strategyParams,
    },
    options
  );
}

export async function getSymbolLists() {
  const settings = await getSettings();

  return {
    allowed: settings.strategy.allowedSymbols,
    blocked: settings.strategy.blockedSymbols,
    watch: settings.strategy.watchSymbols,
  };
}

export async function updateSymbolList(type, symbols, options = {}) {
  const normalized = normalizeSymbols(symbols);
  const map = {
    allowed: "allowedSymbols",
    blocked: "blockedSymbols",
    watch: "watchSymbols",
  };
  const key = map[type];

  if (!key) {
    throw new Error(`Unknown symbol list type: ${type}`);
  }

  const validation = await updateSettings(
    {
      strategy: {
        [key]: normalized,
      },
    },
    options
  );

  try {
    await prisma.$transaction([
      prisma.symbolList.updateMany({
        data: {
          enabled: false,
        },
        where: {
          type,
        },
      }),
      ...normalized.map((symbol) =>
        prisma.symbolList.upsert({
          create: {
            symbol,
            type,
          },
          update: {
            enabled: true,
          },
          where: {
            type_symbol: {
              symbol,
              type,
            },
          },
        })
      ),
    ]);
  } catch {
    // The settings write is authoritative; symbol rows are a query optimization.
  }

  return validation;
}
