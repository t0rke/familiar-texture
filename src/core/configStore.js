import fs from "fs";
import path from "path";
import { logEvent } from "./ledger.js";

export const SETTINGS_FILE = path.join("data", "settings.json");
export const LIVE_CONFIRMATION_TEXT = "ENABLE LIVE TRADING";

export const STRATEGY_DEFINITIONS = {
  starter_voo: "Starter VOO guard: hold when VOO is already owned, otherwise buy a tiny VOO starter position.",
  fixed_dca: "Fixed DCA: buy a fixed dollar amount of each watched symbol when risk checks allow it.",
  dip_buyer: "Dip buyer: buy watched symbols only when their live quote is below the configured threshold.",
  rebalance: "Rebalance: suggest buys or sells when holdings drift beyond the configured allocation threshold.",
  manual_signal: "Manual signal: only act on a user-created trade proposal, still subject to risk checks.",
};

export const DEFAULT_SETTINGS = {
  mode: {
    dryRun: true,
    tradingEnabled: false,
    confirmLiveOrder: false,
  },
  strategy: {
    activeStrategy: "starter_voo",
    watchSymbols: ["VOO", "VTI", "SPY", "QQQ"],
    allowedSymbols: ["VOO", "VTI", "SPY", "QQQ"],
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

function quarantineSettingsFile(reason) {
  if (!fs.existsSync(SETTINGS_FILE)) return null;

  const backupFile = `${SETTINGS_FILE}.invalid-${Date.now()}`;
  fs.renameSync(SETTINGS_FILE, backupFile);

  lastSettingsError = {
    backupFile,
    message: reason,
    recoveredAt: new Date().toISOString(),
  };

  return backupFile;
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
  addRangeError(errors, normalized, "ui.refreshIntervalSeconds", 5, 3600);

  if (!["fixed_dollars", "percent_of_buying_power", "volatility_adjusted", "equal_weight"].includes(normalized.modelTuning.positionSizingMode)) {
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

export function getSettings() {
  ensureSettingsDir();

  if (!fs.existsSync(SETTINGS_FILE)) {
    atomicWriteJson(SETTINGS_FILE, DEFAULT_SETTINGS);
    lastSettingsError = null;
    return structuredClone(DEFAULT_SETTINGS);
  }

  let parsed;

  try {
    parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  } catch (err) {
    const backupFile = quarantineSettingsFile(`Malformed settings JSON: ${err.message}`);
    atomicWriteJson(SETTINGS_FILE, DEFAULT_SETTINGS);
    logEvent({
      type: "SETTINGS_RECOVERED",
      backupFile,
      reason: lastSettingsError?.message,
    });
    return structuredClone(DEFAULT_SETTINGS);
  }

  const validation = validateSettings(parsed);

  if (!validation.valid) {
    const backupFile = quarantineSettingsFile(validation.errors.join(" "));
    atomicWriteJson(SETTINGS_FILE, DEFAULT_SETTINGS);
    logEvent({
      type: "SETTINGS_RECOVERED",
      backupFile,
      errors: validation.errors,
    });
    return structuredClone(DEFAULT_SETTINGS);
  }

  if (JSON.stringify(parsed) !== JSON.stringify(validation.settings)) {
    atomicWriteJson(SETTINGS_FILE, validation.settings);
  }

  lastSettingsError = null;
  return validation.settings;
}

export function getSettingsHealth() {
  return {
    exists: fs.existsSync(SETTINGS_FILE),
    file: SETTINGS_FILE,
    lastError: lastSettingsError,
    ok: !lastSettingsError,
  };
}

export function updateSettings(patch, options = {}) {
  const current = getSettings();
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

  atomicWriteJson(SETTINGS_FILE, validation.settings);

  logEvent({
    type: "SETTINGS_UPDATED",
    actor: options.actor ?? "ui",
    patch,
    warnings: validation.warnings,
  });

  return validation;
}

export function resetSettings(options = {}) {
  atomicWriteJson(SETTINGS_FILE, DEFAULT_SETTINGS);

  logEvent({
    type: "SETTINGS_RESET",
    actor: options.actor ?? "ui",
  });

  return validateSettings(DEFAULT_SETTINGS);
}
