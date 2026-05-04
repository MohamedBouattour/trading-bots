export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
export type IndicatorType = 'RSI' | 'SMA' | 'EMA' | 'ATR' | 'VWAP' | 'VOLUME_MA' | 'MACD' | 'BB';
export type ActionType = 'BUY' | 'SELL' | 'CLOSE' | 'HOLD' | 'TAKE_PROFIT';
export type LogicOperator = 'AND' | 'OR';
export type ComparisonOperator = '>' | '<' | '>=' | '<=' | '==' | '!=';
export type SizeMode = 'pct_balance' | 'pct_position' | 'fixed_usd';

export interface IndicatorDeclaration {
  id: string;
  type: IndicatorType;
  params: Record<string, number>;
  timeframe: Timeframe;
}

export interface Condition {
  left: string;   // indicator id or 'price.close' | 'price.volume' | 'price.high' | 'price.low'
  operator: ComparisonOperator;
  right: number | string; // scalar or another indicator id
}

export interface ConditionGroup {
  logic: LogicOperator;
  conditions: (Condition | { group: ConditionGroup })[];
}

export interface ActionParams {
  sizeMode: SizeMode;
  sizeValue: number;     // percent or USD depending on sizeMode
  leverage?: number;
  takeProfitPct?: number;  // take-profit threshold as a percentage above entry
}

export interface Rule {
  id: string;
  name: string;
  priority: number;      // lower = higher priority
  conditionGroup: ConditionGroup;
  action: ActionType;
  params: ActionParams;
}

export interface RiskConfig {
  maxDrawdownPct: number;
  maxPositionPct: number;
  dailyLossLimitPct: number;
  stopLossMode?: 'atr' | 'fixed_pct';
  stopLossAtrMultiplier?: number;
  stopLossFixedPct?: number;
  /** Trailing stop: move stop-loss up by this % when position is in profit */
  trailingStopPct?: number;
  /** Take-profit: auto-close when position reaches this % gain */
  takeProfitPct?: number;
}

export interface StrategyBlueprint {
  id: string;
  name: string;
  symbols: string[];
  indicators: IndicatorDeclaration[];
  rules: Rule[];
  loop: { intervalSeconds: number };
  riskManagement: RiskConfig;
}
