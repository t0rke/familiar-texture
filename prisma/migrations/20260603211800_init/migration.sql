-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RiskProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "maxDollarsPerTrade" DECIMAL NOT NULL,
    "maxTradesPerDay" INTEGER NOT NULL,
    "maxDailySpend" DECIMAL NOT NULL,
    "maxDailySellAmount" DECIMAL NOT NULL,
    "minBuyingPowerAfterTrade" DECIMAL NOT NULL,
    "maxCashUsagePercentPerRun" DECIMAL NOT NULL,
    "maxPortfolioAllocationPercentPerSymbol" DECIMAL NOT NULL,
    "cooldownMinutesAfterTrade" INTEGER NOT NULL,
    "allowBuys" BOOLEAN NOT NULL DEFAULT true,
    "allowSells" BOOLEAN NOT NULL DEFAULT false,
    "allowOptions" BOOLEAN NOT NULL DEFAULT false,
    "allowCrypto" BOOLEAN NOT NULL DEFAULT false,
    "requireReviewBeforePlace" BOOLEAN NOT NULL DEFAULT true,
    "requireManualConfirmationForLive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StrategyConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "strategyKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "paramsJson" JSONB NOT NULL,
    "riskTolerance" DECIMAL NOT NULL,
    "cashReservePercent" DECIMAL NOT NULL,
    "dipBuyThresholdPercent" DECIMAL NOT NULL,
    "takeProfitPercent" DECIMAL NOT NULL,
    "stopLossPercent" DECIMAL NOT NULL,
    "rebalanceThresholdPercent" DECIMAL NOT NULL,
    "confidenceThreshold" DECIMAL NOT NULL,
    "maxSignalAgeMinutes" INTEGER NOT NULL,
    "positionSizingMode" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SymbolList" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "notes" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TradingRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runNumber" INTEGER,
    "status" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "strategyKey" TEXT,
    "accountNumberMasked" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "summary" TEXT,
    "metadataJson" JSONB
);

-- CreateTable
CREATE TABLE "TradingEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT,
    "type" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT,
    "symbol" TEXT,
    "side" TEXT,
    "amount" DECIMAL,
    "payloadJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TradingEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TradingRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT,
    "accountNumberMasked" TEXT,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "orderType" TEXT NOT NULL,
    "quantity" DECIMAL,
    "dollarAmount" DECIMAL,
    "limitPrice" DECIMAL,
    "stopPrice" DECIMAL,
    "timeInForce" TEXT,
    "marketHours" TEXT,
    "quoteJson" JSONB,
    "orderChecksJson" JSONB,
    "reviewJson" JSONB,
    "approvedForPlacement" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderReview_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TradingRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TradeOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT,
    "robinhoodOrderId" TEXT,
    "refId" TEXT,
    "accountNumberMasked" TEXT,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "orderType" TEXT NOT NULL,
    "state" TEXT,
    "quantity" DECIMAL,
    "dollarAmount" DECIMAL,
    "averagePrice" DECIMAL,
    "limitPrice" DECIMAL,
    "stopPrice" DECIMAL,
    "timeInForce" TEXT,
    "marketHours" TEXT,
    "placedAgent" TEXT,
    "rawJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "filledAt" DATETIME,
    CONSTRAINT "TradeOrder_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TradingRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AccountSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountNumberMasked" TEXT,
    "portfolioValue" DECIMAL,
    "equityValue" DECIMAL,
    "cash" DECIMAL,
    "buyingPower" DECIMAL,
    "rawJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PositionSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountSnapshotId" TEXT,
    "symbol" TEXT NOT NULL,
    "quantity" DECIMAL,
    "averageCost" DECIMAL,
    "marketValue" DECIMAL,
    "rawJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "QuoteSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "price" DECIMAL,
    "bid" DECIMAL,
    "ask" DECIMAL,
    "previousClose" DECIMAL,
    "changePercent" DECIMAL,
    "rawJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Candle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "open" DECIMAL NOT NULL,
    "high" DECIMAL NOT NULL,
    "low" DECIMAL NOT NULL,
    "close" DECIMAL NOT NULL,
    "volume" DECIMAL,
    "source" TEXT NOT NULL,
    "isDelayed" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawJson" JSONB
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor" TEXT NOT NULL DEFAULT 'local-user',
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "metadataJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_key_key" ON "AppSetting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "RiskProfile_name_key" ON "RiskProfile"("name");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyConfig_name_key" ON "StrategyConfig"("name");

-- CreateIndex
CREATE INDEX "SymbolList_type_idx" ON "SymbolList"("type");

-- CreateIndex
CREATE INDEX "SymbolList_symbol_idx" ON "SymbolList"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "SymbolList_type_symbol_key" ON "SymbolList"("type", "symbol");

-- CreateIndex
CREATE INDEX "TradingEvent_runId_idx" ON "TradingEvent"("runId");

-- CreateIndex
CREATE INDEX "TradingEvent_type_idx" ON "TradingEvent"("type");

-- CreateIndex
CREATE INDEX "TradingEvent_createdAt_idx" ON "TradingEvent"("createdAt");

-- CreateIndex
CREATE INDEX "TradingEvent_symbol_idx" ON "TradingEvent"("symbol");

-- CreateIndex
CREATE INDEX "OrderReview_runId_idx" ON "OrderReview"("runId");

-- CreateIndex
CREATE INDEX "OrderReview_symbol_idx" ON "OrderReview"("symbol");

-- CreateIndex
CREATE INDEX "OrderReview_createdAt_idx" ON "OrderReview"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradeOrder_refId_key" ON "TradeOrder"("refId");

-- CreateIndex
CREATE INDEX "TradeOrder_symbol_idx" ON "TradeOrder"("symbol");

-- CreateIndex
CREATE INDEX "TradeOrder_state_idx" ON "TradeOrder"("state");

-- CreateIndex
CREATE INDEX "TradeOrder_createdAt_idx" ON "TradeOrder"("createdAt");

-- CreateIndex
CREATE INDEX "AccountSnapshot_createdAt_idx" ON "AccountSnapshot"("createdAt");

-- CreateIndex
CREATE INDEX "PositionSnapshot_symbol_idx" ON "PositionSnapshot"("symbol");

-- CreateIndex
CREATE INDEX "PositionSnapshot_createdAt_idx" ON "PositionSnapshot"("createdAt");

-- CreateIndex
CREATE INDEX "QuoteSnapshot_symbol_idx" ON "QuoteSnapshot"("symbol");

-- CreateIndex
CREATE INDEX "QuoteSnapshot_createdAt_idx" ON "QuoteSnapshot"("createdAt");

-- CreateIndex
CREATE INDEX "Candle_symbol_interval_timestamp_idx" ON "Candle"("symbol", "interval", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Candle_symbol_interval_timestamp_source_key" ON "Candle"("symbol", "interval", "timestamp", "source");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
