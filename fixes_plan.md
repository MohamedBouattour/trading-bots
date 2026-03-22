# Fixes Plan - Trading Bots Audit

This document outlines the fixes for the unresolved bugs identified in the `AUDIT.md` and confirmed through codebase analysis.

## Critical Fixes

### 1. Leverage Application in Position Sizing
- **Bug:** Bots currently simulate spot trading (1x) even if `LEVERAGE` is set in `.env`. `BaseStrategyBot` and its derivatives do not use a leverage multiplier when calculating quantity.
- **Fix:** 
    - Add `leverage` field to `BotConfig`.
    - Update `BaseStrategyBot` to accept and store `leverage` (defaulting to 1).
    - Modify `_open_position` in `BaseStrategyBot` and `RsiSmaCrossoverBot` to multiply `trade_allocation` by `this.leverage`.
    - Ensure `_market_sell` and `_close_position` correctly calculate PnL and return balance based on the leveraged position.

### 2. Fee Calculation on Notional Value
- **Bug:** Fees are currently calculated on the margin (cost), not the full notional value (leverage * margin).
- **Fix:**
    - Update `_open_position` and `_market_sell` to calculate fees based on `qty * price` (the notional value), regardless of whether it's a spot or futures simulation. This is more accurate for Binance Futures.

## Medium Severity Fixes

### 3. RSI SMA History Buffer Window
- **Bug:** `_rsi_history` in `RsiSmaCrossoverBot` is capped at `_rsi_sma_period * 2`, which might be smaller than `_rsi_ob_os_lookback`.
- **Fix:**
    - Update the cap to `Math.max(this._rsi_sma_period * 2, this._rsi_ob_os_lookback + 2)`.

### 4. RsiEmaTrendBot Redundant History
- **Bug:** `RsiEmaTrendBot` maintains its own `_ohlcvHistory` instead of using the provided `closes_history`.
- **Fix:**
    - Refactor `RsiEmaTrendBot` and `RsiEmaTrendStrategy` to use `closes_history` and other provided history arrays.
    - Remove the redundant `_ohlcvHistory` from `RsiEmaTrendBot`.

### 5. O(n²) RSI Calculation in RsiEmaTrendStrategy
- **Bug:** `checkSignal` recalculates full RSI for multiple past candles in a loop.
- **Fix:**
    - Optimize RSI calculation by either maintaining a running RSI state or at least only calculating it for the necessary window.
    - Ideally, update `IndicatorService` to support efficient RSI updates.

### 6. StructuralGridBot Inconsistent Sizing
- **Bug:** Multiple entries each use 30% of `initial_balance`, leading to inconsistent sizing as `balance` decreases.
- **Fix:**
    - Change sizing logic to use a percentage of current `equity` or a fixed portion of the `initial_balance` only if enough `balance` remains, ensuring consistency across all 3 grid levels.

## Minor Fixes & Logic Improvements

### 7. FixedTargetBot TP1/TP2 Logic
- **Bug:** TP2 check precedes TP1, potentially skipping TP1 and leaving its meta flag unreachable.
- **Fix:**
    - Reorder checks or handle both: if `high` hits TP2, ensure it also counts as hitting TP1 if it wasn't already hit (or just sell all and clear meta).
    - Better: check TP1 first, then TP2.

### 8. RSI Smoothing (Wilder's)
- **Bug:** `IndicatorService.computeRSI` uses SMA for gains/losses instead of Wilder's smoothing.
- **Fix:**
    - Update `computeRSI` to use the correct smoothing algorithm (EMA-based).

### 9. PullbackRiderBot Touch Detection
- **Bug:** Touch detection might be off-by-one or use stale EMA.
- **Fix:**
    - Ensure `ema21` is computed including the current candle if that's what's intended for "touch" detection, OR clarify the strategy definition.

## Verification Plan
- After each fix, run the relevant tests:
    - `npm test src/momentum-sniper/domain/bot/MomentumBot.test.ts`
    - `npm test src/momentum-sniper/domain/bot/RsiEmaTrendBot.test.ts`
    - `npm test src/momentum-sniper/domain/bot/PAXGIntegration.test.ts`
- Create new test cases for leverage and fee calculation to ensure correctness.
- Run backtests and compare results with the `AUDIT.md` observations.
