# Fix Plan — RSI + 100 EMA Strategy Compliance & Bug Resolution

> **Created:** 2026-03-22  
> **Scope:** All open issues from `AUDIT.md` + spec compliance review  
> **Target:** Align codebase with the 1-Year Backtest Report spec (RSI 7 + 100 EMA, BTC/USDT 4H, 5x leverage, 0.04% fee)

---

## Priority Legend

| Icon | Meaning                                                                  |
| ---- | ------------------------------------------------------------------------ |
| 🔴   | Critical — directly breaks live trading or causes wrong backtest results |
| 🟠   | Medium — incorrect behavior under certain conditions                     |
| 🟡   | Minor — cosmetic, documentation, or edge-case only                       |

---

## 🔴 Fix 1 — `run_bot.ts`: Pass `leverage` and `use_futures` to bot config

**Problem:** `run_bot.ts` reads `LEVERAGE` and `USE_FUTURES` from `.env` into local variables (lines 61-62) but **never passes them into the `config` object** (lines 99-112). The bot runs at 1x leverage in live mode regardless of `.env`.

**File:** `src/momentum-sniper/presentation/cli/run_bot.ts`

**Change:**

```typescript
// ADD these two lines to the config object (after line 111):
leverage:               parseFloat(process.env.LEVERAGE || "5"),
use_futures:            process.env.USE_FUTURES === "true",
```

**Acceptance:** Bot constructor receives `leverage=5` and `use_futures=true` when those env vars are set.

---

## 🔴 Fix 2 — `run_bot.ts`: Align fallback defaults with spec

**Problem:** Fallback defaults in `run_bot.ts` use old strategy values (TP 12%, SL 6%, RSI 14, RSI SMA 14, Fee 0.1%). If `.env` keys are ever missing, the bot silently uses wrong parameters.

**File:** `src/momentum-sniper/presentation/cli/run_bot.ts`

**Changes (lines 101-111):**

```typescript
// BEFORE → AFTER
take_profit_pct:  parseFloat(process.env.TAKE_PROFIT || "12.0"),    → "6.0"
stop_loss_pct:    parseFloat(process.env.STOP_LOSS   || "6.0"),     → "1.5"
rsi_period:       parseInt(process.env.RSI_PERIOD    || "14"),      → "7"
rsi_sma_period:   parseInt(process.env.RSI_SMA_PERIOD || "14"),     → "7"
fee_pct:          parseFloat(process.env.FEE_PCT     || "0.1"),     → "0.04"
```

**Acceptance:** When `.env` is empty, `bot.get_config()` returns `{ take_profit_pct: 6.0, stop_loss_pct: 1.5, rsi_period: 7, rsi_sma_period: 7, fee_pct: 0.04 }`.

---

## 🔴 Fix 3 — `backtest_cli.ts`: Align fallback defaults with spec

**Problem:** Same stale defaults issue as Fix 2, but in the backtest CLI.

**File:** `src/momentum-sniper/presentation/cli/backtest_cli.ts`

**Changes (lines 37-46):**

```typescript
// BEFORE → AFTER
fee_pct:          parseFloat(process.env.FEE_PCT     || "0.1"),     → "0.04"
```

The other defaults in `backtest_cli.ts` are already correct (TP 6.0, SL 1.5, RSI 7, RSI SMA 7).

**Acceptance:** Backtest uses 0.04% fee when `FEE_PCT` env var is absent.

---

## 🔴 Fix 4 — Double entry-fee deduction in PnL calculation

**Problem:** Entry fee is charged **twice** — once at position open (`_open_position` deducts `margin + fee` from balance) and again at position close (`_market_sell` subtracts `fee_entry` from PnL). This understates profits by one entry fee per trade.

**Files:**

- `src/momentum-sniper/domain/bot/StrategyBots.ts` → `BaseStrategyBot._market_sell()` (line 130)
- `src/momentum-sniper/domain/bot/RsiSmaCrossoverBot.ts` → `_close_position()` (line 296)

**Change in `StrategyBots.ts` (line 126-131):**

```typescript
// BEFORE:
const fee_entry = (notional_entry * this.fee_pct) / 100;
const pnl =
  pos.side === "LONG"
    ? notional_exit - notional_entry - fee_exit - fee_entry
    : notional_entry - notional_exit - fee_exit - fee_entry;

// AFTER: Remove fee_entry from PnL since it was already deducted at open
const pnl =
  pos.side === "LONG"
    ? notional_exit - notional_entry - fee_exit
    : notional_entry - notional_exit - fee_exit;
```

**Same change in `RsiSmaCrossoverBot.ts` (lines 291-299):**

```typescript
// BEFORE:
const fee_entry = (notional_entry * this.fee_pct) / 100;
let pnl: number;
if (pos.side === "LONG") {
  pnl = notional_exit - notional_entry - fee_exit - fee_entry;
} else {
  pnl = notional_entry - notional_exit - fee_exit - fee_entry;
}

// AFTER: Remove fee_entry line entirely, remove fee_entry from PnL
let pnl: number;
if (pos.side === "LONG") {
  pnl = notional_exit - notional_entry - fee_exit;
} else {
  pnl = notional_entry - notional_exit - fee_exit;
}
```

**Acceptance:** Running a backtest with a single known trade should show PnL = `(exit_notional - entry_notional - exit_fee)` with no duplicate entry fee.

---

## 🔴 Fix 5 — `RsiSmaCrossoverBot`: RSI SMA period fallback should be 7, not 14

**Problem:** `RsiSmaCrossoverBot.ts:71` defaults to `14` when config is missing.

**File:** `src/momentum-sniper/domain/bot/RsiSmaCrossoverBot.ts`

**Change (line 71):**

```typescript
// BEFORE:
this._rsi_sma_period = config.rsi_sma_period ?? 14;
// AFTER:
this._rsi_sma_period = config.rsi_sma_period ?? 7;
```

**Acceptance:** `new RsiSmaCrossoverBot({ symbol: 'BTCUSDT', initial_balance: 1000 })` uses `_rsi_sma_period = 7`.

---

## 🔴 Fix 6 — `.env` STRATEGY value: clarify which bot matches the spec

**Problem:** `.env` currently sets `STRATEGY=rsi_sma_crossover`, which selects `RsiSmaCrossoverBot`. This bot has an **extra condition not in the spec**: it requires RSI to have been below SMA for `rsi_under_sma_duration` (5) **consecutive candles** before a crossover signal fires. The spec only requires RSI to have been below 40 at any point in the last 5 candles.

**Decision required:** There are two options:

### Option A — Remove the duration filter from `RsiSmaCrossoverBot` _(recommended)_

Remove the `_rsi_under_sma_counter >= _rsi_under_sma_duration` check from lines 205 and 212 in `RsiSmaCrossoverBot.ts`. This makes it match the spec exactly. Keep using `STRATEGY=rsi_sma_crossover` in `.env`.

### Option B — Switch `.env` to `STRATEGY=rsi_ema_trend`

Set `STRATEGY=rsi_ema_trend` in `.env` to use `RsiEmaTrendBot`, which delegates to `RsiEmaTrendStrategy` and **does not** have the duration filter. This already conforms to the spec signal logic.

**Recommendation:** **Option A**, because `RsiSmaCrossoverBot` is the more mature implementation (has state serialization, `fromJSON`, trailing stop, trend reversal exit). Removing one filter line is less risky than switching bots entirely.

**Change for Option A — `RsiSmaCrossoverBot.ts` (lines 200-212):**

```typescript
// BEFORE:
const long_signal =
  crossed_above &&
  close > emaTrend &&
  was_oversold &&
  this._rsi_under_sma_counter >= this._rsi_under_sma_duration;

const short_signal =
  crossed_below &&
  close < emaTrend &&
  was_overbought &&
  this._rsi_above_sma_counter >= this._rsi_above_sma_duration;

// AFTER:
const long_signal = crossed_above && close > emaTrend && was_oversold;

const short_signal = crossed_below && close < emaTrend && was_overbought;
```

**Acceptance:** Backtest trade count and win rate should now more closely match spec (77 trades, 25.97% win rate).

---

## 🟠 Fix 7 — RSI SMA history buffer too small for OB/OS lookback

**Problem:** `RsiSmaCrossoverBot` caps `_rsi_history` at `rsi_sma_period * 2` (=14 for period 7). But `rsi_ob_os_lookback` (5) is sliced from this same buffer. If OB/OS lookback + SMA period exceeds the buffer cap, the lookback window is truncated.

**File:** `src/momentum-sniper/domain/bot/RsiSmaCrossoverBot.ts`

**Change (lines 114-120):**

```typescript
// BEFORE:
const bufferCap = Math.max(
  this._rsi_sma_period * 2,
  this._rsi_ob_os_lookback + this._rsi_sma_period + 1,
);

// This is actually already fixed in the current code. Verify the condition holds:
// bufferCap = max(14, 5 + 7 + 1) = max(14, 13) = 14 → OK for current params
// But add a safety margin:
const bufferCap = Math.max(
  this._rsi_sma_period * 3,
  this._rsi_ob_os_lookback + this._rsi_sma_period + 5,
);
```

**Acceptance:** `_rsi_history` always has enough elements for both SMA computation and lookback slicing.

---

## 🟠 Fix 8 — `RsiEmaTrendBot` builds independent OHLCV history

**Problem:** `RsiEmaTrendBot.on_candle()` ignores the `closes_history` array passed by `RunBacktestUseCase` and maintains its own `_ohlcvHistory`. The history limit is `trend_period * 2 + 50` (250 for EMA-100), which is adequate, but the bot runs on a fundamentally different data pipeline than all other bots.

**File:** `src/momentum-sniper/domain/bot/RsiEmaTrendBot.ts`

**Change:** This is by design since `RsiEmaTrendStrategy.checkSignal()` needs full OHLCV data (not just closes). No code change needed, but add a comment documenting this intentional divergence:

```typescript
// NOTE: This bot maintains its own OHLCV history because RsiEmaTrendStrategy
// requires full OHLCV candles, not just closes. The closes_history parameter
// from the backtest runner is not used. The _historyLimit ensures enough data
// for EMA warmup (trend_period * 2 + 50 = 250 candles for EMA-100).
```

**Acceptance:** Comment added. No behavioral change.

---

## 🟠 Fix 9 — `RsiEmaTrendStrategy` O(n²) RSI recalculation

**Problem:** `checkSignal()` calls `computeWilderRSI(rsiWindow.slice(0, i+1))` in a loop for `minRequired` iterations. Each call processes the full slice. This is O(n²).

**File:** `src/momentum-sniper/domain/strategies/RsiEmaTrendStrategy.ts`

**Change:** Pre-compute RSI incrementally using a single pass:

```typescript
// Replace the loop (lines 86-90) with a single computeWilderRSI call
// that returns the full RSI series, then slice the last minRequired values.
// This requires adding a computeWilderRSISeries method to IndicatorService.
```

**New method in `src/shared/indicators/IndicatorService.ts`:**

```typescript
static computeWilderRSISeries(data: number[], period: number): number[] {
  const result: number[] = [];
  if (data.length < period + 1) {
    return data.map(() => 50);
  }
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = data[i] - data[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  // Fill warmup period with 50
  for (let i = 0; i <= period; i++) result.push(50);
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    avgGain = (avgGain * (period - 1) + (diff >= 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}
```

**Then update `RsiEmaTrendStrategy.checkSignal()` (lines 80-90):**

```typescript
const allRsi = IndicatorService.computeWilderRSISeries(closes, this.RSI_PERIOD);
const rsiValues = allRsi.slice(-minRequired);
```

**Acceptance:** Same RSI values produced, but O(n) instead of O(n²). Verify by comparing backtest output before and after.

---

## 🟠 Fix 10 — `FixedTargetBot`: TP2 can fire before TP1

**Problem:** On a candle where `high >= entry * 1.24`, the entire position is sold at TP2 without TP1 ever firing. The `tp1_hit` flag is never set.

**File:** `src/momentum-sniper/domain/bot/StrategyBots.ts` (lines 316-329)

**Change:** Reorder to check TP1 first:

```typescript
// BEFORE: TP1 is checked first (confirmed lines 316-329 show TP1 then TP2)
// Actually re-reading the code, TP1 IS checked first (line 316) and TP2 second (line 327).
// The AUDIT.md description was based on an older version. Current code is correct.
// Verify current order and confirm no change needed.
```

**Acceptance:** If the current code already checks TP1 before TP2 (which it does at lines 316-329), no change. Mark as resolved.

---

## 🟠 Fix 11 — `StructuralGridBot` over-allocates on grid entries

**Problem:** Grid entries attempt 33% of `initial_balance` each, but after entry 1, `balance` has dropped while allocation is still based on `initial_balance`.

**File:** `src/momentum-sniper/domain/bot/StrategyBots.ts` (lines 631-639)

**Change:** The current code already has dynamic sizing logic:

```typescript
const size_pct_dynamic =
  remainingSlots > 0
    ? Math.min(
        33.33,
        ((this.balance / this.initial_balance) * 100) / remainingSlots,
      )
    : 0;
```

This caps allocation to available balance. The `Math.min(this.balance, trade_allocation)` in `_open_position` also guards against overdraft. **No change needed** — current code is already safe.

**Acceptance:** Mark as resolved.

---

## 🟡 Fix 12 — Update `STRATEGY.md` to match spec

**Problem:** `STRATEGY.md` still describes the old RSI Pullback strategy.

**File:** `src/momentum-sniper/STRATEGY.md`

**Change:** Replace entire contents with the current spec:

- EMA 100, RSI 7, RSI SMA 7
- Oversold 40, Overbought 60, Lookback 5
- SL 1.5%, TP 6.0%
- LONG + SHORT signals
- Leverage 5x, Fee 0.04%

**Acceptance:** `STRATEGY.md` documents the exact strategy spec from the backtest report.

---

## 🟡 Fix 13 — Update `.env.example` to match spec

**Problem:** `.env.example` shows old grid strategy defaults (TP 0.8, SL 2.0, etc.)

**File:** `.env.example`

**Change:** Replace with current spec-aligned defaults:

```env
API_KEY=your_binance_api_key
SECRET_KEY=your_binance_secret_key
ASSET='BTC/USDT'
TIME_FRAME='4h'
BALANCE=10000
LEVERAGE=5
USE_FUTURES=true
FEE_PCT=0.04
STRATEGY=rsi_sma_crossover
MONTHS=12

# Optimized RSI + 100 EMA Strategy Parameters
RSI_PERIOD=7
RSI_SMA_PERIOD=7
TREND_PERIOD=100
STOP_LOSS=1.5
TAKE_PROFIT=6.0
RSI_UNDER_SMA_DURATION=5
MAX_EXPOSURE=100
MAX_DD_EXIT=10.0
MOVE_SL_TO_BE_AT_PCT=0.0
EXIT_ON_TREND_REVERSAL=false
TRAILING_STOP=0.0
```

**Acceptance:** `.env.example` matches the spec and serves as correct documentation.

---

## 🟡 Fix 14 — `PullbackRiderBot` off-by-one in EMA touch detection

**Problem:** `previous_close` is `closes_history[closes_history.length - 1]` which is actually the prior candle's close (since `RunBacktestUseCase` pushes after `on_candle`). This is correct behavior per the current backtest runner, but fragile.

**File:** `src/momentum-sniper/domain/bot/StrategyBots.ts` (line 486)

**Change:** Add a clarifying comment. No code change needed since the backtest runner's push-after-on_candle pattern makes this work correctly:

```typescript
// closes_history contains all candles BEFORE the current one (pushed after on_candle).
// So closes_history[length-1] is the previous candle's close, which is correct.
const previous_close = closes_history[closes_history.length - 1];
```

**Acceptance:** Comment added. No behavioral change.

---

## Execution Order

| Phase                                     | Fixes                                    | Risk                             | Est. Time |
| ----------------------------------------- | ---------------------------------------- | -------------------------------- | --------- |
| **Phase 1** — Critical live trading fixes | #1, #2, #3, #5                           | Low (config changes only)        | 15 min    |
| **Phase 2** — PnL accuracy                | #4 (double fee)                          | Medium (changes trade results)   | 15 min    |
| **Phase 3** — Strategy alignment          | #6 (duration filter removal)             | High (changes signal generation) | 20 min    |
| **Phase 4** — Performance & robustness    | #7, #9 (RSI buffer, O(n²) fix)           | Medium                           | 30 min    |
| **Phase 5** — Documentation               | #8, #12, #13, #14                        | None                             | 15 min    |
| **Phase 6** — Verification                | Re-run backtest, compare metrics to spec | —                                | 10 min    |

### Post-Fix Verification

After all fixes, run:

```bash
npx tsx src/momentum-sniper/presentation/cli/backtest_cli.ts
```

Expected output should approximate the spec:

- **ROI:** ~64.53%
- **Total Trades:** ~77
- **Win Rate:** ~25.97%
- **Initial Balance:** 10,000 USDT (if BALANCE updated)
- **Final Value:** ~16,452.67 USDT

> ⚠️ Exact numbers may shift slightly after Fix #4 (double fee removal) and Fix #6 (duration filter removal), since both affect trade outcomes. A full re-backtest is required to establish the new baseline.
