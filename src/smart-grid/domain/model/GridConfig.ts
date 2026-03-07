export interface GridConfig {
  /** Trading symbol, e.g. BTCUSDT */
  readonly symbol: string;
  /** Number of buy grid levels (default: 15) */
  readonly gridCount: number;
  /** Total % below current price the grid covers (default: 15) */
  readonly swingPct: number;
  /** Take-profit % above each buy level (default: 1) */
  readonly takeProfitPct: number;
}
