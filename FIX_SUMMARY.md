# FIX SUMMARY

## Bugs Fixed

- **Lookahead Bias in Lookback:** The RSI confirmation window was evaluating the signal candle itself. Restricted the verification slice to explicitly avoid the boundary.
- **Same-Candle Realism & Lookahead:** Positions were opening and testing limits against the same tick's extremes. We've gated exit checks using an explicit `.meta.opened_at_candle` property. Filtered out incomplete final candles from the data block fetching.
- **Position Sizing Fixed:** Allocation multiplier logic was calculating off fixed `initial_balance` rather than calculating off real uninvested equity and leverage. Rebuilt the risk math resolving formula to balance allocations organically without relying on undocumented 0.99 haircuts.
- **Configuration Typing Gaps:** Repaired types, stripping heavily abused `any` casts mapping against `.env` variables that didn't match the `BotConfig` strict interface object.
- **End-of-data PNL Leaks:** Positions left open at the tail-end of backtests falsely reported win rates (because PNL array entries were missing). Forced all open positions to close out realistically at the final available printed close.

## Behaviors Intentionally Changed

- **Strategy Indicator Parameters:** Implemented explicit >= / <= logical crossover detections against the RSI + SMA.
- **Implemented advanced SL/TP trailing:** Overhauled the position loop iteration to sequentially process exit conditions: Drawdown halts -> Baseline TP/SL -> Reversal Exits -> Breakeven Transitions -> Trailing SL Adjustments. This ordering ensures risk bounds remain deterministic frame-by-frame.
- **Drawdown Circuit Breaker:** Implemented a new hard limit parameter. Falling past `MAX_DD_EXIT` percent from Peak Equity permanently zeroes positions and bars the bot from re-entering the market.

## Assumptions Made

1. **Break-Even means Absolute BE:** I've implemented the break-even trigger (`move_sl_to_be_at_pct`) to transition the Stop Loss directly to `pos.entry_price`. It doesn't mathematically add entry/exit fees to ensure a purely breakeven PNL, as that would aggressively skew stopouts due to higher probability noise.
2. **Reversal Exit > Trailing SL Update:** Real-world tick data triggers SL limits mid-candle, whereas Reversals (Close < EMA) are confirmed on candle close. Hence, intra-candle limit hits mathematically preempt Reversals for realism.
3. **Compounding Limits:** Max Exposure applies dynamically to actual total equity limit. If you take losses, compounding inherently shrinks sizing geometrically.
