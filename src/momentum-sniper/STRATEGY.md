# SOL/USDT Optimized RSI Pullback Strategy (4h)

## Overview
This is a high-conviction "Buy the Dip" strategy designed for simplicity and risk management. It avoids complex indicators and focuses on buying extreme oversold conditions in a confirmed uptrend.

---

## 1. Core Logic

### A. The Trend Filter
- **Condition:** `Price > EMA 100`.
- **Reasoning:** We only buy when the short-term/medium-term trend is bullish. This avoids catching "falling knives" in a bear market.

### B. The Entry Trigger (The Dip)
- **Condition:** `RSI (14) < 45`.
- **Reasoning:** Identifies moments where the asset is temporarily oversold. By entering at RSI 45 while the trend is bullish, we are betting on a quick recovery.

### C. Simple Exit Management
The strategy uses fixed percentage targets to ensure consistent risk/reward:
- **Take Profit (TP):** Fixed **12%** above entry (Customizable via `.env`).
- **Stop Loss (SL):** Fixed **6%** below entry (Customizable via `.env`).
- **Move SL to Break-Even:** Moves the stop loss to the entry price if the price moves in favor by a set percentage (e.g., 1% or higher).

---

## 2. Risk Management
- **Trade Size:** 100% of initial balance per trade (Non-compounding).
- **Fees:** 0.1% per trade (simulated).
- **Execution:** Market orders on candle close.

---

## 3. Backtest Results (SOL/USDT 4h)
- **Period:** 1 Year (March 2025 - March 2026)
- **Initial Balance:** $1000
- **Final Value:** $1676.45
- **Total ROI:** 67.64%
- **Monthly ROI:** ~5.6%
- **Max Drawdown:** 16.13%
- **Win Rate:** 55.56%
- **Total Trades:** 18

---

## 4. How to Configure (.env)
You can change the strategy behavior using these variables:
- `ASSET='SOL/USDT'`
- `TIME_FRAME='4h'`
- `TAKE_PROFIT=12`
- `STOP_LOSS=6`
- `RSI_THRESHOLD=45`
- `TREND_PERIOD=100`
- `BALANCE=1000`
