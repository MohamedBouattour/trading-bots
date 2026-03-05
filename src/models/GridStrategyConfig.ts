export interface GridStrategyConfig {
  symbol?: string;
  initial_balance?: number;
  grid_density?: number;
  qty_per_order?: number;
  volatility_lookback?: number;
  trend_period?: number;
  trend_threshold?: number;
  take_profit_pct?: number;
  stop_loss_pct?: number;
  trailing_stop_pct?: number;
  martingale_factor?: number;
}
