import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_SETTINGS = {
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
    confirmLiveOrder: false,
    dryRun: true,
    tradingEnabled: false,
  },
  modelTuning: {
    cashReservePercent: 25,
    confidenceThreshold: 0.75,
    dipBuyThresholdPercent: 1.5,
    maxSignalAgeMinutes: 30,
    positionSizingMode: "fixed_dollars",
    rebalanceThresholdPercent: 10,
    riskTolerance: 0.15,
    stopLossPercent: 5,
    takeProfitPercent: 8,
  },
  risk: {
    cooldownMinutesAfterTrade: 30,
    maxCashUsagePercentPerRun: 20,
    maxDailySellAmount: 0,
    maxDailySpend: 5,
    maxDollarsPerTrade: 1,
    maxPortfolioAllocationPercentPerSymbol: 20,
    maxTradesPerDay: 1,
    minBuyingPowerAfterTrade: 1,
    requireManualConfirmationForLive: true,
    requireReviewBeforePlace: true,
  },
  strategy: {
    activeStrategy: "aaoi_dip_reversal",
    allowBuys: true,
    allowCrypto: false,
    allowOptions: false,
    allowSells: false,
    allowedSymbols: ["AAOI"],
    blockedSymbols: [],
    fixedDcaAmount: 1,
    manualSignal: null,
    rebalanceTargets: {},
    watchSymbols: ["AAOI", "QQQ", "SPY"],
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
    compactMode: false,
    refreshIntervalSeconds: 60,
    theme: "system",
  },
};

async function main() {
  await prisma.appSetting.upsert({
    create: {
      key: "settings",
      valueJson: DEFAULT_SETTINGS,
    },
    update: {
      valueJson: DEFAULT_SETTINGS,
    },
    where: {
      key: "settings",
    },
  });

  await prisma.riskProfile.upsert({
    create: {
      allowBuys: true,
      allowCrypto: false,
      allowOptions: false,
      allowSells: false,
      cooldownMinutesAfterTrade: 30,
      isActive: true,
      maxCashUsagePercentPerRun: 20,
      maxDailySellAmount: 0,
      maxDailySpend: 5,
      maxDollarsPerTrade: 1,
      maxPortfolioAllocationPercentPerSymbol: 20,
      maxTradesPerDay: 1,
      minBuyingPowerAfterTrade: 1,
      name: "default",
      requireManualConfirmationForLive: true,
      requireReviewBeforePlace: true,
    },
    update: {
      isActive: true,
    },
    where: {
      name: "default",
    },
  });

  await prisma.strategyConfig.upsert({
    create: {
      cashReservePercent: 25,
      confidenceThreshold: 0.75,
      dipBuyThresholdPercent: 1.5,
      isActive: true,
      maxSignalAgeMinutes: 30,
      name: "AAOI dip reversal",
      paramsJson: DEFAULT_SETTINGS.strategyParams.aaoi_dip_reversal,
      positionSizingMode: "fixed_dollars",
      rebalanceThresholdPercent: 10,
      riskTolerance: 0.15,
      stopLossPercent: 5,
      strategyKey: "aaoi_dip_reversal",
      takeProfitPercent: 8,
    },
    update: {
      isActive: true,
      paramsJson: DEFAULT_SETTINGS.strategyParams.aaoi_dip_reversal,
    },
    where: {
      name: "AAOI dip reversal",
    },
  });

  for (const [type, symbols] of Object.entries({
    allowed: ["AAOI"],
    blocked: [],
    watch: ["AAOI", "QQQ", "SPY"],
  })) {
    for (const symbol of symbols) {
      await prisma.symbolList.upsert({
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
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      action: "DATABASE_SEEDED",
      entityType: "AppSetting",
      metadataJson: {
        strategy: DEFAULT_SETTINGS.strategy.activeStrategy,
      },
    },
  });
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
