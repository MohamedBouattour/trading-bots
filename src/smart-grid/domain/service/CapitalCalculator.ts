import { AssetBalance } from "../model/Balance";

export interface CapitalSnapshot {
  /** Total portfolio value denominated in quote asset */
  readonly effectiveCapital: number;
  /** ROI % relative to initial capital */
  readonly roiPct: number;
  /** Absolute PnL in quote asset */
  readonly pnlQuote: number;
}

/**
 * Pure function — no side effects, no I/O.
 * Capital = free + locked quote + (free + locked base) * currentPrice.
 * Falls back to initialCapital when exchange returns zero balances (dry-run mode).
 */
export function computeCapital(
  quoteBalance: AssetBalance,
  baseBalance: AssetBalance,
  currentPrice: number,
  initialCapital: number,
): CapitalSnapshot {
  const totalQuote = quoteBalance.free + quoteBalance.locked;
  const totalBase = baseBalance.free + baseBalance.locked;
  const realCapital = totalQuote + totalBase * currentPrice;
  const effectiveCapital = realCapital > 0 ? realCapital : initialCapital;
  const pnlQuote = effectiveCapital - initialCapital;
  const roiPct = (pnlQuote / initialCapital) * 100;
  return { effectiveCapital, roiPct, pnlQuote };
}
