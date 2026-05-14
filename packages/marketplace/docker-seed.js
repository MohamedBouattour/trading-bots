const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

const STRATEGY_SEEDS = [
  { name: 'Golden Cross', description: 'Buy when fast SMA crosses above slow SMA, sell on reverse cross.', type: 'ma_crossover', config: { fastPeriod: 10, slowPeriod: 30 } },
  { name: 'RSI Mean Reversion', description: 'Buy when RSI exits oversold, sell when RSI exits overbought.', type: 'rsi', config: { rsiPeriod: 14, oversold: 30, overbought: 70 } },
  { name: 'Bollinger Bounce', description: 'Buy at lower band, sell at upper band. Works best in ranging markets.', type: 'bollinger', config: { period: 20, stdDev: 2 } },
  { name: 'MACD Momentum', description: 'Trade on MACD line crossovers above/below the signal line.', type: 'macd', config: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 } },
  { name: 'Fast MA Crossover', description: 'Aggressive MA crossover with shorter periods for frequent signals.', type: 'ma_crossover', config: { fastPeriod: 5, slowPeriod: 15 } },
  { name: 'RSI Extreme', description: 'Ultra-conservative RSI at extreme oversold/overbought levels.', type: 'rsi', config: { rsiPeriod: 21, oversold: 20, overbought: 80 } },
  { name: 'Bollinger Squeeze', description: 'Tight Bollinger Bands with 1.5 std dev for early breakout detection.', type: 'bollinger', config: { period: 20, stdDev: 1.5 } },
  { name: 'Scalper MA', description: 'Ultra-fast MA crossover on minute data for scalping.', type: 'ma_crossover', config: { fastPeriod: 3, slowPeriod: 8 } },
  { name: 'RSI Divergence Hunter', description: 'Longer RSI period to spot divergences.', type: 'rsi', config: { rsiPeriod: 28, oversold: 35, overbought: 65 } },
  { name: 'Trend Rider MACD', description: 'MACD with longer signal line for smoother entries.', type: 'macd', config: { fastPeriod: 8, slowPeriod: 21, signalPeriod: 13 } },
];

const MARKETPLACE_METADATA = [
  { author: 'QuantAlgo', monthlyROI: 3.2, totalROI: 28.5, popularity: 95, fastestGrowing: true, downloads: 1420, rating: 4.5 },
  { author: 'TradeBot Pro', monthlyROI: 2.8, totalROI: 22.1, popularity: 88, fastestGrowing: true, downloads: 980, rating: 4.2 },
  { author: 'AlgoTrader', monthlyROI: 1.9, totalROI: 15.4, popularity: 72, fastestGrowing: false, downloads: 650, rating: 3.8 },
  { author: 'CipherWave', monthlyROI: 4.1, totalROI: 35.2, popularity: 91, fastestGrowing: true, downloads: 2100, rating: 4.7 },
  { author: 'RapidFire', monthlyROI: 5.3, totalROI: 42.0, popularity: 78, fastestGrowing: true, downloads: 1850, rating: 4.0 },
  { author: 'SafeHaven', monthlyROI: 1.2, totalROI: 9.8, popularity: 65, fastestGrowing: false, downloads: 320, rating: 3.5 },
  { author: 'BreakoutBot', monthlyROI: 3.7, totalROI: 30.1, popularity: 82, fastestGrowing: true, downloads: 1100, rating: 4.3 },
  { author: 'TickTock', monthlyROI: 6.1, totalROI: 48.3, popularity: 85, fastestGrowing: true, downloads: 2300, rating: 4.1 },
  { author: 'DeepTrade', monthlyROI: 2.5, totalROI: 20.0, popularity: 70, fastestGrowing: false, downloads: 540, rating: 3.9 },
  { author: 'MacroMind', monthlyROI: 3.0, totalROI: 25.6, popularity: 76, fastestGrowing: false, downloads: 780, rating: 4.4 },
];

async function seed() {
  console.log('Seeding strategies...');

  const existing = await prisma.marketplaceStrategy.count();
  if (existing > 0) {
    console.log(`Already seeded (${existing} strategies found), skipping.`);
    return;
  }

  for (let i = 0; i < STRATEGY_SEEDS.length; i++) {
    const s = STRATEGY_SEEDS[i];
    const m = MARKETPLACE_METADATA[i];

    const strategy = await prisma.strategy.create({
      data: {
        name: s.name,
        description: s.description,
        type: s.type,
        config: s.config,
        isPublic: true,
      },
    });

    await prisma.marketplaceStrategy.create({
      data: {
        name: s.name,
        description: s.description,
        strategyId: strategy.id,
        author: m.author,
        monthlyROI: m.monthlyROI,
        totalROI: m.totalROI,
        popularity: m.popularity,
        fastestGrowing: m.fastestGrowing,
        downloads: m.downloads,
        rating: m.rating,
        isPublished: true,
      },
    });

    console.log(`  Seeded: ${s.name}`);
  }

  console.log('Seeding complete!');
}

seed()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
