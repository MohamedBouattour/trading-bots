# Binance Stock Perpetuals – Core + Sprint Strategy

This document describes a 2-week to 3‑month hybrid strategy for Binance USDT‑M stock perpetual futures, designed for implementation via cron jobs in this repository.

---

## 1. Portfolio Structure

The strategy runs two layers simultaneously:

- **Core bucket (70% of equity)** – long‑term holdings, low turnover, near‑spot exposure
- **Sprint bucket (30% of equity)** – active trades held from ~2 weeks up to 3 months

### 1.1 Core bucket targets (within 70%)

Target weights inside the 70% core allocation:

- AAPLUSDT: 30%
- MSFTUSDT or GOOGLUSDT (whichever is available / preferred): 25%
- TSMUSDT: 15%
- NVDAUSDT: 10%
- MUUSDT: 5%
- USDT buffer: 15% (never fully deployed; protects against margin/liquidation risk)

### 1.2 Sprint bucket targets (within 30%)

Target weights inside the 30% sprint allocation (these are upper bounds, not always fully used):

- NVDAUSDT: 30%
- MUUSDT: 25%
- TSLUSDT (TSLA perp): 20%
- METAUSDT / AMDUSDT: 15%
- USDT reserve: 10%

The sprint bucket is only used when valid setups exist; otherwise more USDT is kept idle.

---

## 2. Leverage and Risk

- Default leverage: **1x** for all positions (or minimum allowed by Binance)
- Hard cap: **1.5x** on any single position
- Maintain **≥ 30% free margin** in the futures wallet
- Use **ISOLATED** margin for sprint positions, **CROSS** only for core (with monitoring)

Risk per trade (as % of total equity):

- Core position trade (1–3 months): max 0.5%
- Position trade in sprint bucket (1–3 months): max 1.5%
- Short‑term sprint trade (2 weeks): max 1.0%
- Max total open risk across all positions: 5% of equity

If portfolio drawdown exceeds 20% from peak, pause all new sprint entries for 2 weeks.

---

## 3. Trading Styles by Horizon

### 3.1 2‑week sprints (swing trades)

Objective: capture 5–15% moves over ~10 trading days.

Setup rules on daily timeframe:

- Uptrend filter: price > EMA20 and price > EMA50
- Breakout entry:
  - Close > highest high of prior 10 trading days
  - Volume on breakout day > 1.3× 20‑day average volume
- Pullback entry (buy the dip in an uptrend):
  - Price remains > EMA50
  - Close within ~2% of EMA20 after a pullback
  - RSI(14) between 40 and 55 (not overbought)

Stops and targets:

- Initial stop: entry − 1.5 × ATR(14) (or last swing low)
- Initial take‑profit: entry + 3 × ATR(14)
- If trade is in profit after ~5 days, trail stop to below 5‑day low

Max 3 sprint positions open at any time.

### 3.2 1–3 month positions (position trades)

Objective: ride larger trend legs driven by earnings and sector rotation.

Setup rules on weekly + daily timeframes:

- Weekly uptrend: higher highs/lows, close above weekly EMA20 and EMA50
- Positive narrative: recent earnings beat, strong guidance, or sector leadership
- Entry on:
  - Weekly breakout with daily retest, or
  - Pullback to support (EMA20/EMA50) while weekly trend remains up

Stops and targets:

- Initial stop: 8–15% below entry (typically 1–2 ATR below weekly swing low)
- Take‑profit: at least 3R (3 × initial risk); partial profits possible at 2R
- If weekly structure breaks (close below EMA50 + lower low), exit early

---

## 4. Cron Job Schedule

All times in UTC; actual cron expressions assume the bot runs on a server using UTC.

### 4.1 Daily – stop & exit management

**Cron:** `0 8 * * *`

Tasks:

1. For each open sprint position:
   - If Mark Price ≤ stop‑loss → close position.
   - If Mark Price ≥ take‑profit → close or take 50% profits and trail stop.
   - If position is profitable and open > 5 trading days, trail stop below 5‑day low.
2. For each core position:
   - If margin ratio < 15%, reduce the smallest core position by ~30%.
3. Log all actions.

### 4.2 Daily – funding rate scan

**Cron:** `0 20 * * *`

Tasks:

1. Read current funding rates for all open perps.
2. If a position has paid positive funding > 0.05% for 3 consecutive days and unrealized PNL is small (< 2× total funding paid), consider closing or reducing.
3. Log funding history per symbol.

### 4.3 Weekly – signal scan for new entries

**Cron:** `0 9 * * 1`  (every Monday)

Tasks:

1. For each asset in the sprint list:
   - Fetch last 60 daily candles.
   - Compute EMA20, EMA50, ATR(14), 20‑day average volume.
   - Evaluate breakout and pullback conditions described above.
2. For each valid setup:
   - Compute position size: `size = (risk_pct * equity) / (entry − stop)`.
   - Enforce max 25% of sprint bucket per trade.
   - Open long with entry, stop, and take‑profit set.
3. Ensure no more than 3 concurrent sprint trades.

### 4.4 Bi‑weekly – sprint review

**Cron:** `0 9 * * 1/2`  (every other Monday)

Tasks:

1. For sprint trades open ≥ 10 trading days:
   - If PNL > 0 and structure is still bullish (price > EMA20): promote to position trade
     - Widen stop to 1.5 × ATR below EMA50
     - Extend target to 1–3 month horizon.
   - If PNL < 0 and price < EMA20: close (thesis failed).
   - If flat and choppy: close to free capital.
2. Log promotions/closures and update sprint bucket balance.

### 4.5 Monthly – core rebalance

**Cron:** `0 10 1 * *`  (1st of every month)

Tasks:

1. Compute current core allocation weights vs targets.
2. If any core position deviates by more than ±5 percentage points from its target weight:
   - Sell overweight positions, buy underweight ones.
   - Preserve 15% USDT buffer.
3. Keep effective core leverage ≤ 1x.
4. Log pre‑ and post‑rebalance weights and PNL.

### 4.6 Quarterly – full cycle review

**Cron:** `0 10 1 */3 *`  (every 3 months)

Tasks:

1. Close all sprint positions open > 60 trading days.
2. For core positions:
   - If 3‑month ROI < −15% → cut position size by 50%.
   - If 3‑month ROI > +30% → trim 20% to lock profits.
3. Output a summary report for the cycle:
   - Total PNL, best/worst sprints, drift in core weights, total funding paid.
4. Reset sprint bucket: after closing, wait for new signals in the next weekly scan.

---

## 5. Global Risk & Safety Rules

These checks should be enforced in every cron job run:

- Max total open risk (sum of planned stop losses): 5% of equity.
- Max single sprint trade risk: 1% of sprint bucket equity.
- Max single core trade risk: 0.5% of core bucket equity.
- Margin ratio must stay above 20%. If breached, immediately reduce or close sprint positions.
- Do not enter new positions within 48 hours before an earnings release for that symbol.
- If drawdown from last equity peak exceeds 20%, disable new sprint entries for 14 days.

---

## 6. Implementation Notes

- This repo can map these rules into TypeScript/Node services by:
  - A scheduler layer (cron) that triggers services in `/src`.
  - Signal services for breakout/pullback detection.
  - A risk manager that calculates sizes and enforces global limits.
  - An execution layer that sends Binance futures orders and updates the DB.
- The JSON structure in logs should include timestamp, cron job ID, symbol, action, reason, entry/exit, PNL, ROI, and total portfolio value to allow backtesting of operational behaviour.

This file is purely a specification; actual implementation should respect existing architecture and abstractions in this repository.
