# 🛠️ Fix Plan — AUDIT.md Bug Resolution

> Generated: 2026-03-22
> Based on: Code audit cross-referenced against source files

---

## Verification Summary

| #   | Audit Claim                                   | Verdict          | Real Bug?                     | Priority |
| --- | --------------------------------------------- | ---------------- | ----------------------------- | -------- |
| 1   | Leverage not applied in position sizing       | ✅ **CONFIRMED** | YES — Critical                | 🔴 P0    |
| 2   | Fee on margin, not leveraged notional         | ✅ **CONFIRMED** | YES — Critical                | 🔴 P0    |
| 3   | RSI SMA window too small for OB/OS lookback   | ⚠️ **PARTIALLY** | Edge case only                | 🟡 P2    |
| 4   | RsiEmaTrendBot owns separate OHLCV history    | ✅ **CONFIRMED** | YES — By design but risky     | 🟠 P1    |
| 5   | O(n²) RSI recalculation in strategy           | ✅ **CONFIRMED** | YES — Performance             | 🟠 P1    |
| 6   | StructuralGrid over-allocates on grid entries | ⚠️ **PARTIALLY** | Minor — has `too_close` guard | 🟡 P2    |
| 7   | FixedTargetBot TP1 skipped on TP2 candle      | ✅ **CONFIRMED** | YES — Logic bug               | 🟡 P2    |
| 8   | RSI SMA vs Wilder smoothing drift             | ✅ **CONFIRMED** | YES — Accuracy divergence     | 🟡 P3    |
| 9   | PullbackRider off-by-one EMA touch            | ✅ **CONFIRMED** | YES — History timing bug      | 🟠 P1    |
| 10  | DeepValueBot RSI < 20 rarely triggers         | ❌ **NOT A BUG** | Design choice, not a bug      | ⚪ N/A   |

---

## Detailed Bug Verification

### Bug 1 — Leverage Not Applied in Position Sizing ✅ CONFIRMED CRITICAL

**Files:** `StrategyBots.ts` (line 87-89), `RsiSmaCrossoverBot.ts` (lines 241-243, 258-260), `BotConfig.ts`

**Evidence:**

```typescript
// StrategyBots.ts _open_position() — line 87-89
const trade_allocation = this.initial_balance * (size_pct / 100);
const spendable = Math.min(this.balance, trade_allocation) * 0.99;
const qty = spendable / price;
```

- `BotConfig` has **no** `leverage` field.
- `.env` sets `LEVERAGE=5` and `USE_FUTURES=true`, but **nothing reads these values** into the bot.
- The constructor of `BaseStrategyBot` does not accept or store leverage.
- All position sizing is calculated purely on `initial_balance * size_pct / 100` — pure spot 1x logic.

**Verdict:** This is a **real, critical bug**. The backtest simulates spot trading even when configured for 5x futures.

---

### Bug 2 — Fee Calculated on Margin, Not Leveraged Notional ✅ CONFIRMED CRITICAL

**Files:** `StrategyBots.ts` (line 90-91), `RsiSmaCrossoverBot.ts` (lines 244-245, 261-262)

**Evidence:**

```typescript
// StrategyBots.ts _open_position() — line 90-91
const cost = qty * price; // This IS the margin (not notional)
const fee = (cost * this.fee_pct) / 100; // Fee on margin only
```

- Since leverage isn't applied to qty (Bug 1), `cost` represents the margin, not the full contract notional.
- On Binance Futures, fees are charged on `notional = margin × leverage`.
- At 5x leverage, fees are **understated by 5x** in the backtest.

**Verdict:** This is a **real, critical bug**. Directly follows from Bug 1 — once leverage is applied, fees must also be computed on the full notional.

---

### Bug 3 — RSI SMA Window Too Small for OB/OS Lookback ⚠️ PARTIALLY CONFIRMED

**File:** `RsiSmaCrossoverBot.ts` (lines 107-109, 185)

**Evidence:**

```typescript
// Line 107-109 — buffer cap
if (this._rsi_history.length > this._rsi_sma_period * 2) {
  this._rsi_history.shift();
}

// Line 185 — lookback slice
const lookback = this._rsi_history.slice(-this._rsi_ob_os_lookback);
```

- Default: `rsi_sma_period = 14`, cap = `14 * 2 = 28`. Lookback = `5`.
- With 28 entries and a lookback of 5, the lookback slice is always satisfied.
- **However**, with a small `rsi_sma_period` (e.g., 7, cap = 14), and during warmup when the buffer has fewer than `rsi_ob_os_lookback` entries, the `slice` could return fewer than 5 values — but `Array.some()` still works correctly on shorter arrays.

**Verdict:** **Edge case only**, not a showstopper. The buffer could be tighter, but functionally it works for current default configs. Worth a **minor fix** to make the cap explicitly `Math.max(rsi_sma_period * 2, rsi_ob_os_lookback + rsi_sma_period)`.

---

### Bug 4 — RsiEmaTrendBot Owns Separate OHLCV History ✅ CONFIRMED

**File:** `RsiEmaTrendBot.ts` (lines 42, 51-54)

**Evidence:**

```typescript
// Line 42 — parameter named _closes_history (prefixed underscore = explicitly ignored!)
_closes_history: number[],

// Line 51-54 — builds its own history from individual candle args
this._ohlcvHistory.push({ timestamp, open, high, low, close, volume });
if (this._ohlcvHistory.length > this._historyLimit) {
  this._ohlcvHistory.shift();
}
```

- The bot **intentionally ignores** the `closes_history` passed by `RunBacktestUseCase`.
- It builds its own `_ohlcvHistory` from individual candle data.
- `_historyLimit = trend_period + 50` (default: 150) vs `RunBacktestUseCase`'s `historyCap = max(trend_period + 50, 300)` — **different limits**.
- The EMA is computed over the bot's internal history, which caps at 150 candles, while a 100-period EMA needs ~200+ candles for stable convergence.

**Verdict:** **Real bug.** The history is too short for reliable EMA-100 warmup, and it diverges from the standardized history provided by the backtest harness.

---

### Bug 5 — O(n²) RSI Recalculation in Strategy ✅ CONFIRMED

**File:** `RsiEmaTrendStrategy.ts` (lines 79-85)

**Evidence:**

```typescript
const minRequired = this.RSI_SMA_PERIOD + this.CONFIRMATION_LOOKBACK + 1;
// Default: 7 + 5 + 1 = 13
for (let i = ohlcvData.length - minRequired; i < ohlcvData.length; i++) {
  rsiValues.push(
    IndicatorService.computeRSI(closes.slice(0, i + 1), this.RSI_PERIOD),
  );
}
```

- Each `computeRSI()` call operates on `closes.slice(0, i+1)` — potentially the **entire** closes array.
- With default `minRequired = 13`, this creates **13 full RSI computations per candle**.
- For a 2000-candle backtest, that's `13 × 2000 = 26,000` RSI calculations, each iterating up to 2000 values.
- Additionally, the RSI implementation uses SMA (not Wilder's smoothing), so each call from a different starting point yields **slightly different results** vs an incremental approach.

**Verdict:** **Real performance bug.** While it doesn't produce incorrect signals per se (each RSI is internally consistent), it's ~13x slower than necessary and the SMA-based RSI means values shift depending on the window start.

---

### Bug 6 — StructuralGrid Over-Allocates on Grid Entries ⚠️ PARTIALLY CONFIRMED

**File:** `StrategyBots.ts` (lines 603-626)

**Evidence:**

```typescript
// Line 603 — allows up to 3 positions
if (this.positions.length < 3) {
  // Line 613-615 — has a "too_close" guard
  const too_close = this.positions.some(
    (p) => Math.abs(p.entry_price - close) / p.entry_price < 0.05,
  );
  if (!too_close) {
    this._market_buy(close, timestamp, 0, close * 1.2, 30, "STRUCTURAL_DROP");
  }
}
```

- The `_open_position` method (line 87-93):
  ```
  trade_allocation = initial_balance * (30 / 100) = 0.30 * initial_balance
  spendable = Math.min(this.balance, trade_allocation) * 0.99
  ```
- After entry 1: balance ≈ `initial_balance * 0.70`. Entry 2 tries to spend `initial_balance * 0.30` but `Math.min(0.70 * IB, 0.30 * IB) = 0.30 * IB` — still works.
- After entry 2: balance ≈ `initial_balance * 0.40`. Entry 3 tries `0.30 * IB`, and `Math.min(0.40 * IB, 0.30 * IB) = 0.30 * IB` — still works.
- After entry 3: balance ≈ `initial_balance * 0.10` — correctly leaves 10% reserve.
- The `cost + fee > this.balance` guard prevents overdraft.

**Verdict:** **Partially a bug.** The sizing is slightly inconsistent (each entry ignores the capital already allocated), but in practice the `Math.min` and overdraft guard prevent catastrophic failure. The 3 × 30% = 90% total is **by design**. The audit's claim of "inconsistent sizing" is fair but the actual risk is low. Worth a cleanup to use `balance`-based allocation instead.

---

### Bug 7 — FixedTargetBot TP2 Can Fire Before TP1 ✅ CONFIRMED

**File:** `StrategyBots.ts` (lines 303-318)

**Evidence:**

```typescript
} else if (high >= pos.entry_price * 1.24) {
  this._market_sell(pos, pos.entry_price * 1.24, "TP2 (24%)", timestamp);
} else if (
  high >= pos.entry_price * 1.16 &&
  !(pos.meta as any)?.tp1_hit
) {
  this._market_sell(pos, pos.entry_price * 1.16, "TP1 (16%)", timestamp, pos.quantity * 0.5);
  if (pos.meta) (pos.meta as any).tp1_hit = true;
}
```

- If a candle's `high` jumps past `1.24 × entry` in one bar, the **entire position** is sold at TP2.
- TP1 (partial exit at 16%) is **never executed** — the user misses the staged exit.
- The `tp1_hit` flag is never set in the TP2 path, creating dead state.

**Verdict:** **Real logic bug.** On gap candles, the intended 50/50 staged exit is completely bypassed. Fix: check TP1 first, or handle both TPs on the same candle.

---

### Bug 8 — RSI SMA vs Wilder Smoothing Drift ✅ CONFIRMED (Minor)

**File:** `IndicatorService.ts` (lines 54-69)

**Evidence:**

```typescript
static computeRSI(data: number[], period: number = 14): number {
  // Uses simple average over the last `period` changes
  const slice = data.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i] - slice[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const rs = gains / period / (losses / period);
  return 100 - 100 / (1 + rs);
}
```

- This is **Cutler's RSI** (SMA-based), not **Wilder's RSI** (EMA-based) used by TradingView.
- For consistency with the platform the bot trades against, Wilder's smoothing (`prevAvg * (period-1) + current) / period`) would be more appropriate.
- The divergence is most significant in the first 50-100 candles, potentially shifting crossover signals.

**Verdict:** **Real but minor.** The bot's signals are internally consistent, but they will differ from TradingView charts. Low priority unless the goal is to match TV signals exactly.

---

### Bug 9 — PullbackRider Off-by-One EMA Touch ✅ CONFIRMED

**File:** `StrategyBots.ts` (lines 472-473)

**Evidence:**

```typescript
const previous_close = closes_history[closes_history.length - 1];
const touched_21 = low <= ema21 && previous_close > ema21;
```

- `RunBacktestUseCase` passes `[...closes]` (prior closes, **not including the current candle's close**) as `closes_history`.
- So `closes_history[closes_history.length - 1]` is the **previous candle's close** — this is actually **correct** for checking "was above EMA last candle".
- **However**, the `ema21` is computed from `closes_history`, which also does not include the current close. The EMA should ideally include the current close for comparison with the current candle's `low`.
- The comparison `low <= ema21` uses the current candle's low against an EMA computed without the current close — creating a **1-candle lag** on the EMA value.

**Verdict:** **Confirmed subtle bug.** The EMA is computed on data that excludes the current candle, while `low` is the current candle's value. The mismatch means the touch detection compares current price data against a lagged EMA, potentially missing or generating false pullback signals.

---

### Bug 10 — DeepValueBot RSI < 20 Threshold Rarely Triggers ❌ NOT A BUG

**File:** `StrategyBots.ts` (lines 397-398)

**Evidence:**

```typescript
const oversold = rsi < 20;
const low_price = close < sma50 * 0.85; // 15% below SMA
```

- RSI < 20 combined with 15% below SMA50 is intentionally an **extreme** deep-value filter.
- The strategy is **named** "Deep Value" — its entire design philosophy is to buy at extreme lows.
- Firing 1-3 times per year on BTC/4H is exactly the intended behavior for this type of strategy.

**Verdict:** **Not a bug — it's a design choice.** The strategy works as intended. If more trades are desired, the thresholds should be relaxed at the strategy level, not treated as a code defect.

---

## Fix Tasks (Ordered by Priority)

### 🔴 P0 — Critical Fixes (Must-Do)

#### Task 1: Add Leverage Support to BotConfig and Position Sizing

**Files to modify:**

1. `src/models/BotConfig.ts` — Add `leverage?: number` and `use_futures?: boolean` fields
2. `src/momentum-sniper/domain/bot/StrategyBots.ts` —
   - Store `leverage` in `BaseStrategyBot` constructor (default `1`)
   - In `_open_position()`: multiply `qty` by `leverage` to get leveraged quantity
   - Adjust equity calculation in `_update_equity()` to account for leveraged PnL
3. `src/momentum-sniper/domain/bot/RsiSmaCrossoverBot.ts` —
   - Read `leverage` from config
   - Apply in `_open_long()` and `_open_short()`: `qty = (spendable / price) * leverage`
4. `src/momentum-sniper/presentation/cli/backtest_cli.ts` — Read `LEVERAGE` and `USE_FUTURES` from `.env` and pass into `BotConfig`

**Implementation notes:**

- Margin = `spendable / price` (the actual capital locked)
- Quantity = margin-based qty × leverage (the notional position size)
- PnL should be calculated on the **leveraged** quantity
- Add liquidation check: if unrealized loss exceeds margin, force-close

#### Task 2: Fix Fee Calculation for Leveraged Notional

**Files to modify:**

1. `src/momentum-sniper/domain/bot/StrategyBots.ts` — In `_open_position()` and `_market_sell()`:
   ```
   const notional = qty * price;  // qty already includes leverage from Task 1
   const fee = (notional * this.fee_pct) / 100;
   ```
2. `src/momentum-sniper/domain/bot/RsiSmaCrossoverBot.ts` — Same pattern in `_open_long()`, `_open_short()`, `_close_position()`

**Implementation notes:**

- Once Task 1 applies leverage to qty, the fee automatically becomes correct if calculated on `qty * price`
- For Binance Futures: maker fee = 0.02%, taker fee = 0.05% (current code uses 0.1% which is spot fee)
- Consider making `fee_pct` configurable per market type

---

### 🟠 P1 — Important Fixes

#### Task 3: Fix RsiEmaTrendBot History Divergence

**File to modify:** `src/momentum-sniper/domain/bot/RsiEmaTrendBot.ts`

**Changes:**

1. Increase `_historyLimit` to `Math.max((config.trend_period ?? 100) * 2 + 50, 300)` for proper EMA warmup
2. Consider using the `closes_history` from `RunBacktestUseCase` as the primary data source instead of building independent OHLCV history
3. If the separate history is needed for OHLCV data (which contains more than just closes), ensure the limit aligns with the backtest harness's `historyCap`

#### Task 4: Optimize RSI Calculation in RsiEmaTrendStrategy (O(n²) → O(n))

**File to modify:** `src/momentum-sniper/domain/strategies/RsiEmaTrendStrategy.ts`

**Changes:**

1. Replace the loop-based RSI recalculation with a single-pass incremental approach:
   ```typescript
   // Instead of: 13 separate computeRSI(closes.slice(0, i+1)) calls
   // Use: compute RSI once on the full closes, then use a sliding window
   const currentRsi = IndicatorService.computeRSI(closes, this.RSI_PERIOD);
   ```
2. For RSI SMA, maintain a rolling buffer of RSI values per candle instead of recomputing from scratch
3. Alternatively, add `computeRSIHistory()` to `IndicatorService` that returns an array of RSI values in a single pass

#### Task 5: Fix PullbackRider Off-by-One EMA Touch Detection

**File to modify:** `src/momentum-sniper/domain/bot/StrategyBots.ts` (PullbackRiderBot, lines 470-478)

**Changes:**

1. Compute `ema21` using the full close history **including** the current close:
   ```typescript
   const closes_with_current = [...closes_history, close];
   const ema21 = IndicatorService.computeEMA(closes_with_current, 21);
   ```
2. Keep `previous_close = closes_history[closes_history.length - 1]` as-is (correctly references prior candle)

---

### 🟡 P2 — Minor Fixes

#### Task 6: Fix RSI SMA Buffer Cap in RsiSmaCrossoverBot

**File to modify:** `src/momentum-sniper/domain/bot/RsiSmaCrossoverBot.ts` (lines 107-109)

**Changes:**

```typescript
// Replace:
if (this._rsi_history.length > this._rsi_sma_period * 2) {
// With:
const bufferCap = Math.max(this._rsi_sma_period * 2, this._rsi_ob_os_lookback + this._rsi_sma_period + 1);
if (this._rsi_history.length > bufferCap) {
```

#### Task 7: Fix FixedTargetBot TP1/TP2 Order

**File to modify:** `src/momentum-sniper/domain/bot/StrategyBots.ts` (FixedTargetBot, lines 300-318)

**Changes:**

1. Check TP1 **before** TP2, or handle both on the same candle:

```typescript
for (const pos of pos_copy) {
  if (low <= pos.stop_loss_price) {
    this._market_sell(pos, pos.stop_loss_price, "SL", timestamp);
  } else if (high >= pos.entry_price * 1.16 && !(pos.meta as any)?.tp1_hit) {
    // TP1: sell half at 16%
    this._market_sell(
      pos,
      pos.entry_price * 1.16,
      "TP1 (16%)",
      timestamp,
      pos.quantity * 0.5,
    );
    if (pos.meta) (pos.meta as any).tp1_hit = true;
    // Check if the same candle also hits TP2
    if (high >= pos.entry_price * 1.24) {
      this._market_sell(pos, pos.entry_price * 1.24, "TP2 (24%)", timestamp);
    }
  } else if (high >= pos.entry_price * 1.24 && (pos.meta as any)?.tp1_hit) {
    // TP2: sell remaining
    this._market_sell(pos, pos.entry_price * 1.24, "TP2 (24%)", timestamp);
  }
}
```

#### Task 8: Fix StructuralGridBot Sizing Consistency

**File to modify:** `src/momentum-sniper/domain/bot/StrategyBots.ts` (StructuralGridBot, line 617-624)

**Changes:**

- Replace `size_pct = 30` with balance-based allocation:
  ```typescript
  const per_grid_allocation = Math.floor(
    this.balance / (3 - this.positions.length),
  );
  const size_pct_dynamic = (per_grid_allocation / this.initial_balance) * 100;
  this._market_buy(
    close,
    timestamp,
    0,
    close * 1.2,
    size_pct_dynamic,
    "STRUCTURAL_DROP",
  );
  ```

---

### 🟡 P3 — Low Priority / Enhancement

#### Task 9: Implement Wilder's RSI Smoothing (Optional)

**File to modify:** `src/shared/indicators/IndicatorService.ts`

**Changes:**

1. Add `computeWilderRSI()` method using exponential smoothing:
   ```typescript
   static computeWilderRSI(data: number[], period: number = 14): number {
     if (data.length < period + 1) return 50;
     let avgGain = 0, avgLoss = 0;
     // Initial SMA seed
     for (let i = 1; i <= period; i++) {
       const diff = data[i] - data[i - 1];
       if (diff >= 0) avgGain += diff;
       else avgLoss -= diff;
     }
     avgGain /= period;
     avgLoss /= period;
     // Wilder's smoothing
     for (let i = period + 1; i < data.length; i++) {
       const diff = data[i] - data[i - 1];
       avgGain = (avgGain * (period - 1) + (diff >= 0 ? diff : 0)) / period;
       avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
     }
     if (avgLoss === 0) return 100;
     return 100 - 100 / (1 + avgGain / avgLoss);
   }
   ```
2. Optionally make existing bots configurable to choose between SMA-RSI and Wilder-RSI

---

## Implementation Order

```
Phase 1 (Critical — Backtest Accuracy)
├── Task 1: Leverage in BotConfig + position sizing
├── Task 2: Fee on leveraged notional
└── Tests: Verify PnL matches manual calculation at 5x leverage

Phase 2 (Important — Signal Quality)
├── Task 3: RsiEmaTrendBot history alignment
├── Task 4: RSI O(n²) optimization
└── Task 5: PullbackRider EMA off-by-one

Phase 3 (Cleanup — Edge Cases)
├── Task 6: RSI SMA buffer cap
├── Task 7: FixedTargetBot TP order
└── Task 8: StructuralGrid sizing

Phase 4 (Enhancement)
└── Task 9: Wilder's RSI (optional)
```

---

## Not Addressed (No Action Needed)

| Item                            | Reason                                                                 |
| ------------------------------- | ---------------------------------------------------------------------- |
| DeepValueBot RSI < 20 threshold | Design choice, not a bug. Strategy is intentionally ultra-conservative |
| Win rate calculation            | ✅ Already fixed in current code                                       |
| CSV month filtering             | ✅ Already fixed in current code                                       |
| Lookahead bias                  | ✅ Already fixed in current code                                       |
| Incomplete candle filtering     | ✅ Already fixed in current code                                       |
| Unclosed position at end        | ✅ Already fixed in current code                                       |
