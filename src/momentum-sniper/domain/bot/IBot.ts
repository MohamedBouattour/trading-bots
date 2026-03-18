import { BotConfig } from "../../../models/BotConfig";
import { Position } from "../../../models/Position";
import { Trade } from "../../../models/Trade";
import { Order } from "../../../models/Order";

export interface BotSummary {
  period: string;
  duration: string;
  initial_balance: string;
  final_value: string;
  total_profit: string;
  roi_pct: string;
  total_trades: number;
  max_drawdown_pct: string;
  win_rate: string;
}

export interface IBot {
  readonly symbol: string;
  readonly initial_balance: number;
  readonly fee_pct: number;

  balance: number;
  positions: Position[];
  equity_curve: number[];
  sl_curve: (number | null)[];
  trade_log: Trade[];
  open_orders: Map<number, Order>;

  on_candle(
    timestamp: number,
    open: number,
    high: number,
    low: number,
    close: number,
    volume: number,
    closes_history: number[],
    volumes_history?: number[],
    highs_history?: number[],
    lows_history?: number[],
  ): void;

  close_all_positions(price: number, timestamp: number): void;
  summary(): BotSummary;
  get_config(): BotConfig;
  toJSON(): string;
}
