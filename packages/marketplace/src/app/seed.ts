import { DatabaseService } from '@trading-bots/database';

interface LogicDescription {
  summary: string;
  kidFriendly: string;
  entryCondition: string;
  exitCondition: string;
  indicators: { name: string; icon: string; what: string }[];
  diagramSteps: { label: string; formula?: string; arrow: string; isCondition?: boolean }[];
  color: string;
}

interface StrategySeed {
  name: string;
  description: string;
  type: string;
  config: Record<string, unknown>;
  logic: LogicDescription;
}

const STRATEGY_SEEDS: StrategySeed[] = [
  {
    name: 'Golden Cross',
    description: 'Buy when the fast average crosses above the slow average — like a slow-motion high-five between two lines.',
    type: 'ma_crossover',
    config: { fastPeriod: 10, slowPeriod: 30 },
    logic: {
      color: '#e8b4b4',
      summary: 'When the fast line jumps over the slow line, it means the price is starting to go UP. When it dips below, the price is starting to go DOWN.',
      kidFriendly: 'Imagine a turtle and a rabbit racing. The rabbit (fast line) starts behind the turtle (slow line). If the rabbit passes the turtle, it means prices are speeding up — time to BUY! If the rabbit falls behind the turtle, prices are slowing down — time to SELL!',
      entryCondition: 'BUY when the fast 10-day average CROSSES ABOVE the slow 30-day average (called a "Golden Cross")',
      exitCondition: 'SELL when the fast 10-day average CROSSES BELOW the slow 30-day average (called a "Death Cross")',
      indicators: [
        { name: 'Fast SMA (10)', icon: '', what: 'The average price of the last 10 days — moves quickly' },
        { name: 'Slow SMA (30)', icon: '', what: 'The average price of the last 30 days — moves slowly' },
      ],
      diagramSteps: [
        { label: 'Price data comes in', arrow: '↓' },
        { label: 'Calculate Fast (10) & Slow (30) averages', formula: 'SMA = (day1 + day2 + ... + dayN) / N', arrow: '↓' },
        { label: 'Compare the two lines', arrow: '↓' },
        { label: 'Fast above Slow?', arrow: '→', isCondition: true },
        { label: 'BUY signal', arrow: '→' },
        { label: 'Fast below Slow?', arrow: '→', isCondition: true },
        { label: 'SELL signal', arrow: '↓' },
      ],
    },
  },
  {
    name: 'RSI Mean Reversion',
    description: 'Buy when the RSI meter shows the stock is "too cheap" (oversold), sell when "too expensive" (overbought).',
    type: 'rsi',
    config: { rsiPeriod: 14, oversold: 30, overbought: 70 },
    logic: {
      color: '#b4d8e8',
      summary: 'RSI measures how "tired" or "excited" the price is on a scale from 0 to 100. Below 30 = tired and cheap (BUY). Above 70 = excited and expensive (SELL).',
      kidFriendly: 'Think of RSI like a hunger meter. 0 = starving, 100 = stuffed. When the meter drops below 30 (starving), it\'s a good time to BUY (eat!). When it goes above 70 (stuffed), it\'s time to SELL (stop eating!). The price usually bounces back when people get too hungry or too full.',
      entryCondition: 'BUY when RSI drops BELOW 30 (oversold), then rises back ABOVE 30 — the price was too low and is recovering',
      exitCondition: 'SELL when RSI goes ABOVE 70 (overbought), then drops BELOW 70 — the price was too high and is falling',
      indicators: [
        { name: 'RSI (14)', icon: '', what: 'Relative Strength Index — a meter from 0-100. Measures if price is too high or too low.' },
      ],
      diagramSteps: [
        { label: 'Get last 14 days of prices', arrow: '↓' },
        { label: 'Calculate RSI', formula: 'RSI = 100 - 100/(1 + avgGain/avgLoss)', arrow: '↓' },
        { label: 'RSI < 30? (Oversold)', arrow: '→', isCondition: true },
        { label: 'BUY signal', arrow: '→' },
        { label: 'RSI > 70? (Overbought)', arrow: '→', isCondition: true },
        { label: 'SELL signal', arrow: '↓' },
      ],
    },
  },
  {
    name: 'Bollinger Bounce',
    description: 'Buy when the price touches the bottom elastic band, sell when it touches the top band.',
    type: 'bollinger',
    config: { period: 20, stdDev: 2 },
    logic: {
      color: '#d4e8b4',
      summary: 'Bollinger Bands are like elastic bands around the price. When the price stretches too far down, it usually bounces back up. When it stretches too far up, it snaps back down.',
      kidFriendly: 'Imagine a bouncy ball on a rubber band. The band stretches when the ball jumps high and when it falls low. When the ball touches the bottom of the band, it BOUNCES back up (BUY!). When it hits the top, it FALLS back down (SELL!). The middle line is the "resting" position.',
      entryCondition: 'BUY when the price TOUCHES or goes BELOW the lower band (2 standard deviations below average)',
      exitCondition: 'SELL when the price TOUCHES or goes ABOVE the upper band (2 standard deviations above average)',
      indicators: [
        { name: 'Middle Band (SMA 20)', icon: '', what: 'The average price over 20 days — the center line' },
        { name: 'Upper Band', icon: '', what: 'Middle + 2x standard deviation — the "too high" line' },
        { name: 'Lower Band', icon: '', what: 'Middle - 2x standard deviation — the "too low" line' },
      ],
      diagramSteps: [
        { label: 'Get last 20 days of prices', arrow: '↓' },
        { label: 'Calculate average (middle band)', formula: 'SMA = sum(20 prices) / 20', arrow: '↓' },
        { label: 'Calculate upper & lower bands', formula: 'Band = SMA ± 2 × σ', arrow: '↓' },
        { label: 'Price below lower band?', arrow: '→', isCondition: true },
        { label: 'BUY (expect bounce up)', arrow: '→' },
        { label: 'Price above upper band?', arrow: '→', isCondition: true },
        { label: 'SELL (expect bounce down)', arrow: '↓' },
      ],
    },
  },
  {
    name: 'MACD Momentum',
    description: 'Buy when momentum turns positive (MACD line crosses above signal), sell when it turns negative.',
    type: 'macd',
    config: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
    logic: {
      color: '#e8d4b4',
      summary: 'MACD measures the "push" behind the price. When the push turns upward, the price is gaining steam — BUY. When the push weakens, the price is losing steam — SELL.',
      kidFriendly: 'Imagine pushing a swing. MACD is like measuring how hard you\'re pushing. The "MACD line" is your push strength. The "signal line" is the average push strength. When your push gets stronger than average — BUY! When your push gets weaker than average — SELL! The harder you push, the higher the price goes.',
      entryCondition: 'BUY when the MACD line CROSSES ABOVE the signal line (bullish momentum starting)',
      exitCondition: 'SELL when the MACD line CROSSES BELOW the signal line (bearish momentum starting)',
      indicators: [
        { name: 'MACD Line', icon: '', what: 'Fast EMA (12) minus Slow EMA (26) — shows short-term momentum' },
        { name: 'Signal Line', icon: '', what: '9-day average of the MACD line — smooths out noise' },
        { name: 'Histogram', icon: '', what: 'Difference between MACD and Signal — shows if momentum is growing or shrinking' },
      ],
      diagramSteps: [
        { label: 'Get price data', arrow: '↓' },
        { label: 'Calculate Fast EMA(12) & Slow EMA(26)', formula: 'EMA = price × multiplier + prev × (1-multiplier)', arrow: '↓' },
        { label: 'MACD Line = Fast EMA − Slow EMA', arrow: '↓' },
        { label: 'Signal Line = 9-day avg of MACD', arrow: '↓' },
        { label: 'MACD above Signal?', arrow: '→', isCondition: true },
        { label: 'BUY (momentum up)', arrow: '→' },
        { label: 'MACD below Signal?', arrow: '→', isCondition: true },
        { label: 'SELL (momentum down)', arrow: '↓' },
      ],
    },
  },
  {
    name: 'Fast MA Crossover',
    description: 'Quick-moving averages for traders who want faster signals — more action, but more false alarms too.',
    type: 'ma_crossover',
    config: { fastPeriod: 5, slowPeriod: 15 },
    logic: {
      color: '#b4b4e8',
      summary: 'Like the Golden Cross but with shorter windows — the rabbit and turtle are racing on a shorter track. You get more signals but they can be wrong more often.',
      kidFriendly: 'This is like the Golden Cross race but on a shorter track. The rabbit (5-day average) and the turtle (15-day average) race more often! You\'ll see more overtakes (signals), but sometimes the rabbit might fake you out. Great for quick trades!',
      entryCondition: 'BUY when the fast 5-day average CROSSES ABOVE the slow 15-day average',
      exitCondition: 'SELL when the fast 5-day average CROSSES BELOW the slow 15-day average',
      indicators: [
        { name: 'Fast SMA (5)', icon: '', what: 'The average price of the last 5 days — very fast, very sensitive' },
        { name: 'Slow SMA (15)', icon: '', what: 'The average price of the last 15 days — moderately slow' },
      ],
      diagramSteps: [
        { label: 'Price data in', arrow: '↓' },
        { label: 'Calculate Fast SMA(5) & Slow SMA(15)', arrow: '↓' },
        { label: 'Fast line above Slow line?', arrow: '→', isCondition: true },
        { label: 'BUY (bullish)', arrow: '→' },
        { label: 'Fast line below Slow line?', arrow: '→', isCondition: true },
        { label: 'SELL (bearish)', arrow: '↓' },
      ],
    },
  },
  {
    name: 'RSI Extreme',
    description: 'Ultra-safe RSI that only trades at extreme prices — fewer trades, but higher quality signals.',
    type: 'rsi',
    config: { rsiPeriod: 21, oversold: 20, overbought: 80 },
    logic: {
      color: '#e8b4d4',
      summary: 'Same as RSI Mean Reversion but with a wider safety zone. Only acts when the price is REALLY cheap or REALLY expensive. You\'ll trade less often, but each trade has a better chance of winning.',
      kidFriendly: 'Like the RSI hunger meter but with a bigger "stay cool" zone. Instead of acting at 30 and 70, we wait until 20 (REALLY starving) and 80 (REALLY stuffed). You\'ll eat out less often, but when you do, you\'re REALLY hungry! This means fewer trades but each one is stronger.',
      entryCondition: 'BUY when RSI drops BELOW 20 (deep oversold) then recovers above 20',
      exitCondition: 'SELL when RSI goes ABOVE 80 (deep overbought) then drops below 80',
      indicators: [
        { name: 'RSI (21)', icon: '', what: 'RSI with a longer 21-day window — smoother, fewer false signals' },
      ],
      diagramSteps: [
        { label: 'Get last 21 days of prices', arrow: '↓' },
        { label: 'Calculate RSI(21)', arrow: '↓' },
        { label: 'RSI < 20? (Super cheap!)', arrow: '→', isCondition: true },
        { label: 'BUY signal', arrow: '→' },
        { label: 'RSI > 80? (Super expensive!)', arrow: '→', isCondition: true },
        { label: 'SELL signal', arrow: '↓' },
      ],
    },
  },
  {
    name: 'Bollinger Squeeze',
    description: 'Tighter Bollinger Bands catch breakouts earlier — for when the price is about to explode.',
    type: 'bollinger',
    config: { period: 20, stdDev: 1.5 },
    logic: {
      color: '#d8e8b4',
      summary: 'Same bounce idea as Bollinger Bounce, but with tighter bands (1.5 instead of 2). This catches breakouts earlier since the bands are closer to the price.',
      kidFriendly: 'Imagine the bouncy ball with a SHORTER rubber band. The ball doesn\'t have to bounce as high or low before the band snaps back. You catch the bounce earlier! But sometimes the ball might just keep going (false alarm). It\'s like a cat that pounces at the slightest movement.',
      entryCondition: 'BUY when the price touches the lower band (1.5 standard deviations) — earlier bounce signal',
      exitCondition: 'SELL when the price touches the upper band (1.5 standard deviations) — earlier drop signal',
      indicators: [
        { name: 'Middle Band (SMA 20)', icon: '', what: 'Average price over 20 days' },
        { name: 'Tighter Upper Band', icon: '', what: 'Middle + 1.5x std dev — catches high prices earlier' },
        { name: 'Tighter Lower Band', icon: '', what: 'Middle - 1.5x std dev — catches low prices earlier' },
      ],
      diagramSteps: [
        { label: 'Get 20 days of prices', arrow: '↓' },
        { label: 'Calculate middle band (SMA)', arrow: '↓' },
        { label: 'Calculate bands with 1.5x std dev (tighter!)', arrow: '↓' },
        { label: 'Price below lower band?', arrow: '→', isCondition: true },
        { label: 'BUY early', arrow: '→' },
        { label: 'Price above upper band?', arrow: '→', isCondition: true },
        { label: 'SELL early', arrow: '↓' },
      ],
    },
  },
  {
    name: 'Scalper MA',
    description: 'Lightning-fast average crossover for very short-term trades — rapid-fire signals on minute charts.',
    type: 'ma_crossover',
    config: { fastPeriod: 3, slowPeriod: 8 },
    logic: {
      color: '#f0d8b4',
      summary: 'The fastest moving average crossover. The rabbit (3) and turtle (8) sprint every few minutes. Designed for quick in-and-out trades on 1-minute or 5-minute charts.',
      kidFriendly: 'This is the Usain Bolt of strategies! The fastest rabbit (3-beat average) races against a fast turtle (8-beat). They race every few minutes. You\'ll get lots of signals, buy and sell quickly. It\'s like playing a video game where you tap buttons fast!',
      entryCondition: 'BUY when the ultra-fast 3-period average crosses ABOVE the 8-period average',
      exitCondition: 'SELL when the ultra-fast 3-period average crosses BELOW the 8-period average',
      indicators: [
        { name: 'Fast SMA (3)', icon: '', what: 'Average of last 3 candles — extremely sensitive' },
        { name: 'Slow SMA (8)', icon: '', what: 'Average of last 8 candles — moderately fast' },
      ],
      diagramSteps: [
        { label: 'Tick data in (every minute!)', arrow: '↓' },
        { label: 'Fast SMA(3) vs Slow SMA(8)', arrow: '↓' },
        { label: 'Fast crosses above Slow?', arrow: '→', isCondition: true },
        { label: 'BUY NOW!', arrow: '→' },
        { label: 'Fast crosses below Slow?', arrow: '→', isCondition: true },
        { label: 'SELL NOW!', arrow: '↓' },
      ],
    },
  },
  {
    name: 'RSI Divergence Hunter',
    description: 'Expert-level RSI that spots when the price and RSI disagree — catching trend reversals early.',
    type: 'rsi',
    config: { rsiPeriod: 28, oversold: 35, overbought: 65 },
    logic: {
      color: '#c8e8d4',
      summary: 'When price makes a lower low but RSI makes a higher low, the downtrend is "tired" — a reversal is coming. This catches big trend changes before they happen.',
      kidFriendly: 'Imagine a tired runner who keeps going slower and slower (price going down). But his friend cheering sees he\'s actually getting stronger (RSI going up)! When they disagree like this, the runner is about to turn around and sprint the other way. You jump in BEFORE the turn!',
      entryCondition: 'BUY when price makes a LOWER low but RSI makes a HIGHER low (bullish divergence — trend is reversing up)',
      exitCondition: 'SELL when price makes a HIGHER high but RSI makes a LOWER high (bearish divergence — trend is reversing down)',
      indicators: [
        { name: 'RSI (28)', icon: '', what: 'Longer RSI with 28-day window — sees the big picture' },
        { name: 'Price Trend', icon: '', what: 'The actual price movement — sometimes tricks you!' },
      ],
      diagramSteps: [
        { label: 'Get 28+ days of price data', arrow: '↓' },
        { label: 'Calculate RSI(28)', arrow: '↓' },
        { label: 'Price down but RSI up?', arrow: '→', isCondition: true },
        { label: 'Trend reversal coming! BUY', arrow: '→' },
        { label: 'Price up but RSI down?', arrow: '→', isCondition: true },
        { label: 'Trend reversal coming! SELL', arrow: '↓' },
      ],
    },
  },
  {
    name: 'Trend Rider MACD',
    description: 'MACD that smoothes out the noise for steady trend-following — fewer signals, bigger winners.',
    type: 'macd',
    config: { fastPeriod: 8, slowPeriod: 21, signalPeriod: 13 },
    logic: {
      color: '#d4c8e8',
      summary: 'A tuned MACD with a longer signal line (13 instead of 9). This filters out small wiggles and only catches the BIG momentum shifts. Fewer trades, but each one rides a major trend.',
      kidFriendly: 'Imagine surfing. Most people try to catch every tiny wave and fall. This strategy waits for the BIG waves only! The longer signal line (13) is like watching the horizon longer before paddling. You miss the small waves but ride the big ones all the way to shore. Bigger wins, fewer wipeouts!',
      entryCondition: 'BUY when MACD line crosses ABOVE the 13-period signal line (major bullish trend starting)',
      exitCondition: 'SELL when MACD line crosses BELOW the 13-period signal line (major bearish trend starting)',
      indicators: [
        { name: 'MACD (8, 21)', icon: '', what: 'Fast EMA(8) minus Slow EMA(21) — smooth momentum' },
        { name: 'Signal Line (13)', icon: '', what: '13-period average of MACD — filters out noise' },
      ],
      diagramSteps: [
        { label: 'Price data in', arrow: '↓' },
        { label: 'Fast EMA(8) − Slow EMA(21) = MACD', arrow: '↓' },
        { label: 'Signal = 13-day avg of MACD', arrow: '↓' },
        { label: 'MACD above Signal? (Big wave!)', arrow: '→', isCondition: true },
        { label: 'BUY — ride the trend!', arrow: '→' },
        { label: 'MACD below Signal? (Wave over!)', arrow: '→', isCondition: true },
        { label: 'SELL', arrow: '↓' },
      ],
    },
  },
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

export async function seedStrategies(db: DatabaseService) {
  for (let i = 0; i < STRATEGY_SEEDS.length; i++) {
    const s = STRATEGY_SEEDS[i];
    const meta = MARKETPLACE_METADATA[i];

    const configWithLogic = { ...s.config, logicDescription: s.logic };

    let strategy = await db.strategy.findFirst({ where: { name: s.name } });
    if (strategy) {
      strategy = await db.strategy.update({
        where: { id: strategy.id },
        data: {
          description: s.description,
          type: s.type,
          config: configWithLogic,
          isPublic: true,
        },
      });
    } else {
      strategy = await db.strategy.create({
        data: {
          name: s.name,
          description: s.description,
          type: s.type,
          config: configWithLogic,
          isPublic: true,
        },
      });
    }

    const existing = await db.marketplaceStrategy.findUnique({ where: { strategyId: strategy.id } });
    if (existing) {
      await db.marketplaceStrategy.update({
        where: { id: existing.id },
        data: {
          name: s.name,
          description: s.description,
          author: meta.author,
          monthlyROI: meta.monthlyROI,
          totalROI: meta.totalROI,
          popularity: meta.popularity,
          fastestGrowing: meta.fastestGrowing,
          downloads: meta.downloads,
          rating: meta.rating,
          isPublished: true,
        },
      });
    } else {
      await db.marketplaceStrategy.create({
        data: {
          name: s.name,
          description: s.description,
          strategyId: strategy.id,
          author: meta.author,
          monthlyROI: meta.monthlyROI,
          totalROI: meta.totalROI,
          popularity: meta.popularity,
          fastestGrowing: meta.fastestGrowing,
          downloads: meta.downloads,
          rating: meta.rating,
          isPublished: true,
        },
      });
    }
  }
}
