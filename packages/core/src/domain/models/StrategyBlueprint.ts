/**
 * StrategyBlueprint — visual logic schema (BPML)
 *
 * A strategy is defined entirely as JSON metadata.
 * The engine reads this schema and executes it generically.
 * No strategy logic lives in code — only the interpreter does.
 *
 * Condition tree supports nested AND/OR groups.
 * Rules are evaluated in ascending priority order — first match wins.
 */

export type Timeframe = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w";

export type IndicatorType =
  | "SMA" | "EMA" | "RSI" | "ATR" | "MACD" | "BBANDS"
  | "STOCH" | "ADX" | "VOLUME_MA" | "VWAP";

export type ComparisonOperator = ">" | "<" | ">=" | "<=" | "==" | "!=";
export type LogicalOperator = "AND" | "OR";
export type ActionType = "BUY" | "SELL" | "HOLD" | "CLOSE_ALL" | "SET_SL" | "SET_TP";

/** An indicator declaration with its parameters */
export interface IndicatorDeclaration {
  id: string;                     // e.g. "fast_sma"
  type: IndicatorType;
  params: Record<string, number>; // e.g. { period: 14 }
  timeframe: Timeframe;
}

/** A single leaf condition */
export interface Condition {
  left: string;                   // indicator id or "price.close" | "price.volume"
  operator: ComparisonOperator;
  right: string | number;         // indicator id OR literal number
}

/** A condition group with AND/OR logic, supports nesting */
export interface ConditionGroup {
  logic: LogicalOperator;
  conditions: Array<Condition | ConditionGroup>;
}

/** A rule: when conditionGroup is satisfied, fire action */
export interface StrategyRule {
  id: string;
  name: string;
  priority: number;               // lower = higher priority; first match wins
  conditionGroup: ConditionGroup;
  action: ActionType;
  params?: {
    sizeMode?: "fixed" | "pct_balance" | "kelly";
    sizeValue?: number;           // USDT or % depending on sizeMode
    slPct?: number;               // stop-loss % from entry
    tpPct?: number;               // take-profit % from entry
    leverage?: number;
  };
}

/** Loop / scheduler config for bot execution */
export interface LoopConfig {
  intervalSeconds: number;
  maxRuntimeSeconds?: number;
}

/** Top-level strategy blueprint — the only thing you need to write a strategy */
export interface StrategyBlueprint {
  id: string;
  name: string;
  version: string;
  description: string;
  symbols: string[];              // e.g. ["BTCUSDT", "ETHUSDT"]
  defaultTimeframe: Timeframe;
  indicators: IndicatorDeclaration[];
  rules: StrategyRule[];          // evaluated in priority order
  loop: LoopConfig;
  riskManagement: {
    maxDrawdownPct: number;       // halt bot if drawdown exceeds this
    maxPositionPct: number;       // max % of total equity per position
    dailyLossLimitPct: number;    // halt if daily loss exceeds this
  };
  metadata: {
    author: string;
    createdAt: string;
    tags: string[];
  };
}
