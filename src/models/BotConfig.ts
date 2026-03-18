export interface BotConfig {
  symbol?: string;
  initial_balance?: number;
  entry_density?: number;
  qty_per_order?: number;
  volatility_lookback?: number;
  trend_period?: number;
  trend_threshold?: number;
  take_profit_pct?: number;
  stop_loss_pct?: number;
  trailing_stop_pct?: number;
  martingale_factor?: number;
  max_exposure_pct?: number;
  max_drawdown_exit_pct?: number;
  max_order_cost_pct?: number;
  tp_volatility_multiplier?: number;
  order_ttl_candles?: number;
  fee_pct?: number;
  rsi_threshold?: number;
  rsi_period?: number;
  rsi_sma_period?: number;
  rsi_under_sma_duration?: number;
  move_sl_to_be_at_pct?: number;
  exit_on_trend_reversal?: boolean;
}
