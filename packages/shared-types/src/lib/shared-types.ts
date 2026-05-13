export interface User {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKey {
  id: string;
  exchange: string;
  apiKey: string;
  userId: string;
  isActive: boolean;
  createdAt: Date;
}

export type StrategyType = 'ma_crossover' | 'rsi' | 'bollinger' | 'macd' | 'custom';

export interface StrategyConfig {
  [key: string]: unknown;
}

export interface Strategy {
  id: string;
  name: string;
  description: string | null;
  type: StrategyType;
  config: StrategyConfig;
  userId: string | null;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TradingBot {
  id: string;
  name: string;
  userId: string;
  strategyId: string;
  asset: string;
  timeframe: string;
  balance: number;
  leverage: number;
  useFutures: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Trade {
  id: string;
  botId: string;
  side: 'buy' | 'sell';
  symbol: string;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  pnl: number | null;
  pnlPercent: number | null;
  status: 'open' | 'closed';
  openedAt: Date;
  closedAt: Date | null;
}

export interface BotLog {
  id: string;
  botId: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface Candle {
  symbol: string;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: Date;
}

export interface BacktestRun {
  id: string;
  strategyId: string;
  asset: string;
  timeframe: string;
  startDate: Date;
  endDate: Date;
  initialBalance: number;
  finalBalance: number | null;
  totalReturn: number | null;
  sharpeRatio: number | null;
  maxDrawdown: number | null;
  totalTrades: number | null;
  winRate: number | null;
  status: string;
  trades: unknown;
  createdAt: Date;
}

export interface MarketplaceStrategy {
  id: string;
  name: string;
  description: string | null;
  strategyId: string;
  author: string | null;
  monthlyROI: number;
  totalROI: number;
  popularity: number;
  fastestGrowing: boolean;
  downloads: number;
  rating: number;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface BotDecision {
  action: 'buy' | 'sell' | 'hold';
  confidence: number;
  reason: string;
  indicators?: Record<string, number>;
  timestamp: Date;
}

export interface CandleBatch {
  symbol: string;
  timeframe: string;
  candles: Candle[];
}

export interface BacktestResult {
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  totalTrades: number;
  winRate: number;
  trades: Trade[];
  equityCurve: { date: Date; value: number }[];
}

export interface MarketStats {
  symbol: string;
  currentPrice: number;
  priceChange24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
}
