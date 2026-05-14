const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

const STRATEGY_SEEDS = [
  { name: 'Golden Cross', description: 'Buy when fast average crosses above slow average.', type: 'ma_crossover', config: { fastPeriod: 10, slowPeriod: 30, logicDescription: { summary: 'Fast line crossing slow line.', kidFriendly: 'Rabbit 🐇 passes turtle 🐢 = BUY!', entryCondition: 'BUY on Golden Cross', exitCondition: 'SELL on Death Cross', indicators: [{ name: 'Fast SMA 10', icon: '📈', what: '10-day average' }, { name: 'Slow SMA 30', icon: '📊', what: '30-day average' }], diagramSteps: [{ label: 'Price data', arrow: '↓' }, { label: 'Fast vs Slow average', arrow: '↓' }, { label: 'Cross above? BUY', arrow: '→' }, { label: 'Cross below? SELL', arrow: '✓' }], color: '#e8b4b4' } } },
  { name: 'RSI Mean Reversion', description: 'Buy when RSI shows oversold, sell on overbought.', type: 'rsi', config: { rsiPeriod: 14, oversold: 30, overbought: 70, logicDescription: { summary: 'RSI hunger meter.', kidFriendly: 'Starving 🍔 below 30 = BUY! Stuffed above 70 = SELL!', entryCondition: 'BUY when RSI < 30 then crosses above', exitCondition: 'SELL when RSI > 70 then crosses below', indicators: [{ name: 'RSI 14', icon: '📏', what: 'Meter 0-100' }], diagramSteps: [{ label: '14 days price', arrow: '↓' }, { label: 'RSI < 30?', arrow: '→' }, { label: 'BUY!', arrow: '→' }, { label: 'RSI > 70?', arrow: '→' }, { label: 'SELL!', arrow: '✓' }], color: '#b4d8e8' } } },
  { name: 'Bollinger Bounce', description: 'Price bounces between elastic bands.', type: 'bollinger', config: { period: 20, stdDev: 2, logicDescription: { summary: 'Bouncy ball between bands.', kidFriendly: 'Ball 🏀 hits bottom band = BUY! Hits top band = SELL!', entryCondition: 'BUY at lower band', exitCondition: 'SELL at upper band', indicators: [{ name: 'Mid SMA 20', icon: '➖', what: 'Center line' }, { name: 'Upper/Lower', icon: '⬆️⬇️', what: 'Bounce lines' }], diagramSteps: [{ label: '20 days price', arrow: '↓' }, { label: 'Below lower band?', arrow: '→' }, { label: 'BUY bounce up!', arrow: '→' }, { label: 'Above upper band?', arrow: '→' }, { label: 'SELL bounce down!', arrow: '✓' }], color: '#d4e8b4' } } },
  { name: 'MACD Momentum', description: 'Trade momentum crossovers.', type: 'macd', config: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, logicDescription: { summary: 'Momentum swing.', kidFriendly: 'Push swing 🎠 harder = BUY! Push weaker = SELL!', entryCondition: 'BUY on MACD above signal', exitCondition: 'SELL on MACD below signal', indicators: [{ name: 'MACD Line', icon: '📈', what: 'Momentum' }, { name: 'Signal Line', icon: '〰️', what: 'Average momentum' }], diagramSteps: [{ label: 'Price data', arrow: '↓' }, { label: 'MACD = Fast − Slow EMA', arrow: '↓' }, { label: 'MACD above Signal?', arrow: '→' }, { label: 'BUY!', arrow: '→' }, { label: 'MACD below Signal?', arrow: '→' }, { label: 'SELL!', arrow: '✓' }], color: '#e8d4b4' } } },
  { name: 'Fast MA Crossover', description: 'Quick crossovers for fast trades.', type: 'ma_crossover', config: { fastPeriod: 5, slowPeriod: 15, logicDescription: { summary: 'Fast racing cross.', kidFriendly: 'Fast rabbit 🐇 passes turtle 🐢 on short track = BUY!', entryCondition: 'BUY fast crosses above slow', exitCondition: 'SELL fast crosses below slow', indicators: [{ name: 'Fast SMA 5', icon: '🐇', what: '5-day average' }, { name: 'Slow SMA 15', icon: '🐢', what: '15-day average' }], diagramSteps: [{ label: 'Price data', arrow: '↓' }, { label: 'SMA5 vs SMA15', arrow: '↓' }, { label: 'Cross above? BUY', arrow: '→' }, { label: 'Cross below? SELL', arrow: '✓' }], color: '#b4b4e8' } } },
  { name: 'RSI Extreme', description: 'Ultra-safe RSI at extreme levels.', type: 'rsi', config: { rsiPeriod: 21, oversold: 20, overbought: 80, logicDescription: { summary: 'Super safe RSI.', kidFriendly: 'REALLY starving 🍔 at 20 = BUY! REALLY stuffed at 80 = SELL!', entryCondition: 'BUY at RSI < 20', exitCondition: 'SELL at RSI > 80', indicators: [{ name: 'RSI 21', icon: '📏', what: 'Long smooth meter' }], diagramSteps: [{ label: '21 days price', arrow: '↓' }, { label: 'RSI < 20?', arrow: '→' }, { label: 'BUY!', arrow: '→' }, { label: 'RSI > 80?', arrow: '→' }, { label: 'SELL!', arrow: '✓' }], color: '#e8b4d4' } } },
  { name: 'Bollinger Squeeze', description: 'Tighter bands catch early breakouts.', type: 'bollinger', config: { period: 20, stdDev: 1.5, logicDescription: { summary: 'Tighter bounce.', kidFriendly: 'Short rubber band catches ball 🏀 faster = earlier BUY/SELL!', entryCondition: 'BUY at tight lower band', exitCondition: 'SELL at tight upper band', indicators: [{ name: 'Mid SMA', icon: '➖', what: 'Center' }, { name: 'Tight Bands', icon: '⬆️⬇️', what: '1.5x std dev' }], diagramSteps: [{ label: '20 days price', arrow: '↓' }, { label: 'Below tight lower?', arrow: '→' }, { label: 'BUY early!', arrow: '→' }, { label: 'Above tight upper?', arrow: '→' }, { label: 'SELL early!', arrow: '✓' }], color: '#d8e8b4' } } },
  { name: 'Scalper MA', description: 'Lightning-fast scalping cross.', type: 'ma_crossover', config: { fastPeriod: 3, slowPeriod: 8, logicDescription: { summary: 'Ultra fast cross.', kidFriendly: 'Usain Bolt 🏃‍♂️ vs fast turtle on minute chart = RAPID trades!', entryCondition: 'BUY on fast cross above', exitCondition: 'SELL on fast cross below', indicators: [{ name: 'Fast SMA 3', icon: '🚀', what: '3-period' }, { name: 'Slow SMA 8', icon: '🏎️', what: '8-period' }], diagramSteps: [{ label: 'Minute data', arrow: '↓' }, { label: 'SMA3 vs SMA8', arrow: '↓' }, { label: 'Cross above? BUY!', arrow: '→' }, { label: 'Cross below? SELL!', arrow: '✓' }], color: '#f0d8b4' } } },
  { name: 'RSI Divergence Hunter', description: 'Catches trend reversals early.', type: 'rsi', config: { rsiPeriod: 28, oversold: 35, overbought: 65, logicDescription: { summary: 'Spot hidden reversals.', kidFriendly: 'Tired runner 🏃 slows down but friend sees energy rising = about to sprint!', entryCondition: 'BUY on bullish divergence', exitCondition: 'SELL on bearish divergence', indicators: [{ name: 'RSI 28', icon: '📏', what: 'Big picture meter' }, { name: 'Price', icon: '📉', what: 'Actual price' }], diagramSteps: [{ label: '28+ days price', arrow: '↓' }, { label: 'Price down, RSI up?', arrow: '→' }, { label: 'BUY reversal!', arrow: '→' }, { label: 'Price up, RSI down?', arrow: '→' }, { label: 'SELL reversal!', arrow: '✓' }], color: '#c8e8d4' } } },
  { name: 'Trend Rider MACD', description: 'Smooth MACD for big trends.', type: 'macd', config: { fastPeriod: 8, slowPeriod: 21, signalPeriod: 13, logicDescription: { summary: 'Ride big waves only.', kidFriendly: 'Surfing 🏄 — wait for BIG wave, ride it all the way!', entryCondition: 'BUY on MACD above long signal', exitCondition: 'SELL on MACD below long signal', indicators: [{ name: 'MACD 8 21', icon: '📈', what: 'Smooth momentum' }, { name: 'Signal 13', icon: '〰️', what: 'Long filter' }], diagramSteps: [{ label: 'Price data', arrow: '↓' }, { label: 'MACD vs Signal', arrow: '↓' }, { label: 'Above? BUY big trend!', arrow: '→' }, { label: 'Below? SELL', arrow: '✓' }], color: '#d4c8e8' } } },
];

const METADATA = [
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
  for (let i = 0; i < STRATEGY_SEEDS.length; i++) {
    const s = STRATEGY_SEEDS[i];
    const m = METADATA[i];
    let strategy = await prisma.strategy.findFirst({ where: { name: s.name } });
    if (strategy) {
      strategy = await prisma.strategy.update({ where: { id: strategy.id }, data: { description: s.description, type: s.type, config: s.config, isPublic: true } });
    } else {
      strategy = await prisma.strategy.create({ data: { name: s.name, description: s.description, type: s.type, config: s.config, isPublic: true } });
    }
    const existing = await prisma.marketplaceStrategy.findUnique({ where: { strategyId: strategy.id } });
    if (existing) {
      await prisma.marketplaceStrategy.update({ where: { id: existing.id }, data: { name: s.name, description: s.description, author: m.author, monthlyROI: m.monthlyROI, totalROI: m.totalROI, popularity: m.popularity, fastestGrowing: m.fastestGrowing, downloads: m.downloads, rating: m.rating, isPublished: true } });
    } else {
      await prisma.marketplaceStrategy.create({ data: { name: s.name, description: s.description, strategyId: strategy.id, author: m.author, monthlyROI: m.monthlyROI, totalROI: m.totalROI, popularity: m.popularity, fastestGrowing: m.fastestGrowing, downloads: m.downloads, rating: m.rating, isPublished: true } });
    }
    console.log(`  ${s.name}`);
  }
  console.log('Seeding complete!');
}

seed().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
