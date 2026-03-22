# BTC/USDT Optimized RSI + 100 EMA Strategy (4h)

## Overview

This strategy combines a trend-following filter (100 EMA) with a momentum oscillator (RSI) and its Simple Moving Average (SMA) to identify high-probability entry points. It also incorporates a confirmation filter based on recent overbought/oversold conditions and a fixed risk-reward ratio.

---

## 1. Parameters

- **EMA Period:** 100. Prices above the 100 EMA indicate an uptrend, while prices below indicate a downtrend.
- **RSI Period:** 7.
- **RSI SMA Period:** 7.
- **RSI Oversold Threshold:** 40. Used as a confirmation for LONG entries.
- **RSI Overbought Threshold:** 60. Used as a confirmation for SHORT entries.
- **Confirmation Lookback:** 5 candles.
- **Stop Loss (SL):** 1.5%.
- **Take Profit (TP):** 6.0%.
- **Leverage:** 5x.
- **Fee per trade:** 0.04%.

---

## 2. Entry Signals

### LONG Entry:

1. **Price above 100 EMA:** The current candle's closing price must be above the 100 EMA, confirming an uptrend.
2. **RSI Crossover:** The RSI (7) must cross above its SMA (7). This indicates a shift in momentum to the upside.
3. **Oversold Confirmation:** Within the last 5 candles, the RSI (7) must have been below the Oversold Threshold (40).

### SHORT Entry:

1. **Price below 100 EMA:** The current candle's closing price must be below the 100 EMA, confirming a downtrend.
2. **RSI Crossover:** The RSI (7) must cross below its SMA (7). This indicates a shift in momentum to the downside.
3. **Overbought Confirmation:** Within the last 5 candles, the RSI (7) must have been above the Overbought Threshold (60).

---

## 3. Exit Signals

- **Stop Loss (SL):** Fixed 1.5% from entry.
- **Take Profit (TP):** Fixed 6.0% from entry.

---

## 4. Risk Management:

The strategy employs a fixed risk-reward ratio of 1:4 (1.5% risk for 6.0% reward).

---

## 5. How to Configure (.env)

You can change the strategy behavior using these variables:

- `ASSET='BTC/USDT'`
- `TIME_FRAME='4h'`
- `STRATEGY=rsi_sma_crossover`
- `LEVERAGE=5`
- `USE_FUTURES=true`
- `FEE_PCT=0.04`
- `TAKE_PROFIT=6.0`
- `STOP_LOSS=1.5`
- `RSI_PERIOD=7`
- `RSI_SMA_PERIOD=7`
- `TREND_PERIOD=100`
- `MAX_EXPOSURE=100`
