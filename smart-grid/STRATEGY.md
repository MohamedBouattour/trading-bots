# Smart Grid Trading Bot — Strategy Algorithm

> **Target**: Standalone `dist/smart-grid.js` executed every **1 hour** via cron-job  
> **Asset**: BTC/USDT (configurable via `.env`)  
> **Exchange**: Binance (Spot)

---

## 1. High-Level Overview

The Smart Grid Bot is an **adaptive grid trading strategy** for cryptocurrency spot markets. It dynamically places limit-buy orders at calculated grid levels below the current price, and manages open positions with take-profit, stop-loss, and trailing-stop exits.

Unlike static grid bots, this bot continuously adapts:

- **Grid range & density** adjust to real-time volatility
- **Entry filters** use RSI, SMA cross, and trend detection to avoid buying into crashes
- **Position sizing** scales down as exposure grows (anti-martingale capital protection)
- **Emergency circuit breaker** liquidates all positions if drawdown exceeds a threshold

```
┌─────────────────────────────────────────────────────────────┐
│                     CRON TRIGGER (every 1h)                 │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │   1. FETCH MARKET DATA │ ← Binance REST API
              │      (latest candles)  │    Last 200+ 1h candles
              └────────────┬───────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  2. COMPUTE INDICATORS │
              │  • Volatility (σ)      │
              │  • Trend (SMA slope)   │
              │  • SMA 50 / SMA 200    │
              │  • RSI (14)            │
              └────────────┬───────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  3. REGIME DETECTION   │
              │  • Bull / Bear market  │
              │  • Golden / Death cross│
              │  • Strong downtrend?   │
              └────────────┬───────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  4. RISK CHECK         │
              │  • Compute exposure %  │
              │  • Compute drawdown %  │
              │  • Emergency exit?     │
              └────────────┬───────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  5. GRID MANAGEMENT    │
              │  • Rebuild grid if     │
              │    price near boundary │
              │  • Cancel stale orders │
              └────────────┬───────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  6. POSITION MGMT      │
              │  • Check TP / SL / TSL │
              │  • Close profitable    │
              │    positions           │
              └────────────┬───────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  7. ENTRY DECISION     │
              │  • Apply RSI filter    │
              │  • Apply trend filter  │
              │  • Place buy orders    │
              │    on grid levels      │
              └────────────┬───────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  8. EXECUTE ON BINANCE │
              │  • Place/cancel orders │
              │  • Log actions         │
              └──────────────────────────┘
```

---

## 2. Configuration Parameters

| Parameter               | Default  | Description                                            |
| ----------------------- | -------- | ------------------------------------------------------ |
| `symbol`                | BTC/USDT | Trading pair                                           |
| `initial_balance`       | 500.0    | Starting USDT balance                                  |
| `grid_density`          | 100      | Number of grid levels across the range                 |
| `volatility_lookback`   | 24       | Number of candles to compute historical volatility (σ) |
| `trend_period`          | 200      | SMA window for trend slope calculation                 |
| `trend_threshold`       | 0.002    | Minimum SMA slope to declare uptrend/downtrend         |
| `take_profit_pct`       | 0.8%     | Default take-profit distance from entry                |
| `stop_loss_pct`         | 2.0%     | Fixed stop-loss distance from entry                    |
| `trailing_stop_pct`     | 0%       | Trailing stop activation (0 = disabled)                |
| `martingale_factor`     | 3.0      | Size multiplier for deeper grid levels                 |
| `max_exposure_pct`      | 60%      | Maximum portfolio % allocated to open positions        |
| `max_drawdown_exit_pct` | 10%      | Drawdown threshold to trigger emergency liquidation    |

---

## 3. Technical Indicators

### 3.1 Volatility (σ)

- **Method**: Standard deviation of log-returns over `volatility_lookback` candles
- **Formula**: `σ = stddev(ln(close[i] / close[i-1]))` for the last N candles
- **Purpose**: Dynamically size the grid range — wider grids during high volatility, tighter grids when calm

### 3.2 Trend Detection (SMA Slope)

- **Method**: Compare two consecutive SMAs of period `trend_period`
- **Formula**: `slope = (SMA_current - SMA_previous) / SMA_previous`
- **Classification**:
  - `slope > trend_threshold` → **Uptrend**
  - `slope < -trend_threshold` → **Downtrend**
  - Otherwise → **Ranging**

### 3.3 Simple Moving Averages (SMA 50 & SMA 200)

- **SMA 200**: Long-term trend filter — price above SMA 200 = bull market
- **SMA 50**: Medium-term trend — used for golden cross / death cross detection
- **Golden Cross**: `SMA 50 > SMA 200` → medium-term bullish confirmation

### 3.4 Relative Strength Index (RSI-14)

- **Period**: 14 candles
- **Purpose**: Momentum filter to avoid buying into overbought conditions
- **Thresholds**:
  - `RSI < 25`: Deep oversold — buy signal even during crashes
  - `RSI < 35`: Standard buy dip signal
  - `RSI < 55`: Allowed during confirmed **uptrend** + **golden cross**
  - `RSI > 55`: **No buying** (avoiding buying into resistance)

---

## 4. Core Algorithm — Step by Step

### Step 1: Fetch Latest Market Data

On each cron execution (every 1 hour):

```
1. Fetch the last 200+ hourly candles from Binance REST API
2. Extract close prices into a history array
3. Identify the latest candle as the "current" candle
```

### Step 2: Compute All Indicators

```
trend       = computeTrend(closes, trend_period, trend_threshold)
volatility  = computeVolatility(closes, volatility_lookback)
sma200      = computeSMA(closes, 200)
sma50       = computeSMA(closes, 50)
rsi         = computeRSI(closes, 14)
```

### Step 3: Regime Detection

```
is_bull_market      = close > sma200
is_golden_cross     = sma50 > sma200
is_strong_downtrend = trend == "downtrend" AND NOT is_bull_market
```

**Regime Matrix**:
| Condition | Classification | Effect on Strategy |
|------------------------|---------------------|---------------------------------|
| Bull + Uptrend | Strong Bull | Full grid, larger sizes, buy OK |
| Bull + Ranging | Neutral-Bullish | Normal grid, standard sizes |
| Bear + Downtrend | Strong Downtrend | Reduced grid, tiny sizes |
| Bear + Ranging | Neutral-Bearish | Cautious, fewer orders |

### Step 4: Inventory & Risk Assessment

```
btc_held_value    = sum(position.quantity * close) for all positions
locked_balance    = sum(order.price * order.quantity) for all open buy orders
total_equity      = cash_balance + btc_held_value + locked_balance
exposure_pct      = (btc_held_value / total_equity) * 100

peak_equity       = max(peak_equity, total_equity)
current_drawdown  = ((peak_equity - total_equity) / peak_equity) * 100
```

### Step 5: Emergency Circuit Breaker

```
IF current_drawdown >= max_drawdown_exit_pct AND NOT already_in_emergency:
    → Cancel ALL open orders (return locked funds to balance)
    → Liquidate ALL positions at market price
    → Set emergency_exit flag = TRUE
    → STOP all new buying

IF emergency_exit AND drawdown recovers below (max_drawdown_exit_pct * 0.5):
    → Clear emergency_exit flag
    → Resume normal trading
```

**Rationale**: This protects against catastrophic losses during black swan events. The recovery threshold (50% of exit threshold) prevents whipsaw re-entry.

### Step 6: Grid Reconstruction

The grid is rebuilt when price approaches the boundary of the current grid (within 20% of the edge):

```
margin = (grid_upper - grid_lower) * 0.2

IF price is within [grid_lower + margin, grid_upper - margin]:
    → Keep current grid (no action)
ELSE:
    → Recalculate grid around current price
```

**Grid Range Calculation**:

```
range_multiplier = 6.0 if is_strong_downtrend else 4.0
half_range       = price * volatility * range_multiplier * sqrt(volatility_lookback)

trend_bias       = +15% of half_range if uptrend
                   -15% of half_range if downtrend
                   0 if ranging

grid_lower = price - half_range + bias
grid_upper = price + half_range + bias
grid_levels = linspace(grid_lower, grid_upper, effective_density)
```

**Density Adjustment**:

```
effective_density = grid_density * 0.6  if is_strong_downtrend
                    grid_density        otherwise
```

_In strong downtrends, we use fewer grid levels to avoid rapidly accumulating losing positions._

**Dynamic Position Sizing**:

```
base_allocation       = 0.3 if is_strong_downtrend else 0.8
size_reduction_factor = max(0.2, 1 - exposure_pct / 100)
available_capital     = current_total_balance * base_allocation * size_reduction_factor
levels_to_fill        = max(1, floor(effective_density / 2))
qty_per_order         = available_capital / levels_to_fill / current_price
```

_As exposure increases, order size decreases — this is an anti-martingale capital preservation mechanism._

### Step 7: Position Management (Check Exits)

For each open position, check three exit conditions **in priority order**:

#### 7a. Take Profit (TP)

```
# Dynamic TP adjustment based on exposure
IF exposure_pct > 40%:  tp_factor = 0.60  (tighten 40% to de-risk)
IF exposure_pct > 25%:  tp_factor = 0.80  (tighten 20%)
ELSE:                   tp_factor = 1.00  (use full TP)

adjusted_tp = entry_price + (base_tp - entry_price) * tp_factor

# In downtrend, cap TP at 0.8% above entry for quick exit
IF trend == "downtrend":
    adjusted_tp = min(entry_price * 1.008, adjusted_tp)

IF high >= adjusted_tp:
    → SELL at adjusted_tp
    → Log trade with reason = "take_profit"
```

#### 7b. Stop Loss (SL)

```
sl_price = entry_price * (1 - stop_loss_pct / 100)

IF low <= sl_price:
    → SELL at sl_price
    → Log trade with reason = "stop_loss"
```

#### 7c. Trailing Stop (TSL)

```
# Track highest price since entry
IF high > highest_price_seen:
    highest_price_seen = high

trail_price = highest_price_seen * (1 - trailing_stop_pct / 100)

# Only activates when position is in profit
IF trail_price > entry_price AND low <= trail_price:
    → SELL at trail_price
    → Log trade with reason = "trailing_stop"
```

### Step 8: Cancel Stale Orders

```
FOR each open buy order:
    IF order.price > current_price:
        → Cancel order (price moved up past the order)
        → Return locked funds to balance
```

### Step 9: Entry Decision (Place New Buy Orders)

**Entry is ONLY allowed when ALL of these are true:**

```
can_add_exposure = exposure_pct < max_exposure_pct
rsi_allows       = rsi < 35
                   OR (trend == "uptrend" AND is_golden_cross AND rsi < 55)
not_in_crash     = NOT is_strong_downtrend
                   OR rsi < 25  (only deep-oversold buys during crashes)
not_emergency    = emergency_exit_flag == false
```

**If entry is allowed**, place buy limit orders on grid levels below current price:

```
buy_levels = grid_levels.filter(level < current_price).reverse()  // closest first
max_levels = 3 if is_strong_downtrend else 15

FOR each level in buy_levels (up to max_levels):
    IF no existing order at this price level:
        depth_factor  = martingale_factor ^ index  (deeper = larger)

        multiplier = depth_factor
        IF uptrend:           multiplier *= 1.2  (buy more aggressively)
        IF strong_downtrend:  multiplier *= 0.5  (buy very cautiously)

        qty  = qty_per_order * multiplier
        cost = level * qty

        IF balance >= cost:
            → Place BUY LIMIT order at 'level' for 'qty'
            → Deduct cost from balance
```

---

## 5. Execution Flow for Live Cron Mode (`dist/smart-grid.js`)

The standalone script performs the following on each hourly execution:

```
┌──────────────────────────────────────────────────────────────┐
│  dist/smart-grid.js — Cron-Job Entry Point                   │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Load .env configuration (API keys, symbol, balance)      │
│  2. Load persisted bot state from disk (state.json)          │
│     └─ If no state file exists → initialize fresh bot        │
│  3. Connect to Binance API                                   │
│  4. Fetch current account balance & open positions            │
│  5. Fetch latest 200+ hourly candles                          │
│  6. Feed the latest candle into bot.on_candle()               │
│  7. Compute decision:                                        │
│     ├─ Orders to PLACE  (new grid buy orders)                │
│     ├─ Orders to CANCEL (stale/invalidated orders)           │
│     └─ Positions to CLOSE (TP/SL/TSL hit)                    │
│  8. Execute decisions on Binance:                             │
│     ├─ binance.cancelOrder() for stale orders                │
│     ├─ binance.order() for new limit buys                    │
│     └─ binance.order() for market sells (position exits)     │
│  9. Persist updated bot state to disk (state.json)           │
│ 10. Log summary of actions taken                              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### State Persistence (`state.json`)

Between cron runs, the bot persists:

```json
{
  "balance": 850.00,
  "peak_equity": 1025.00,
  "emergency_exit": false,
  "grid_levels": [89500, 89750, 90000, ...],
  "grid_lower": 88000,
  "grid_upper": 95000,
  "open_orders": [
    { "order_id": "binance_123", "side": "buy", "price": 89500, "quantity": 0.001 }
  ],
  "positions": [
    { "entry_price": 90200, "quantity": 0.0012, "tp": 91553, "sl": 85690, "highest_seen": 91000 }
  ],
  "equity_curve": [1000, 1005, 998, ...],
  "trade_log": [...]
}
```

---

## 6. Risk Management Summary

| Mechanism                 | Purpose                                 | Behavior                                                   |
| ------------------------- | --------------------------------------- | ---------------------------------------------------------- |
| **Max Exposure Cap**      | Prevent over-allocation                 | No new buys when exposure > `max_exposure_pct`             |
| **RSI Filter**            | Avoid buying into overbought conditions | Only buy when RSI < 35 (or < 55 in confirmed uptrend)      |
| **Trend Filter**          | Avoid catching falling knives           | Reduce grid density & size in strong downtrends            |
| **Dynamic TP**            | De-risk when heavily exposed            | Tighten take-profit as exposure grows                      |
| **Downtrend TP Cap**      | Quick exits during bear markets         | TP capped at +0.8% in downtrend                            |
| **Stop Loss**             | Hard loss limit per position            | Fixed SL at `stop_loss_pct` below entry                    |
| **Trailing Stop**         | Lock in profits on runners              | Activates only when position is profitable                 |
| **Emergency Liquidation** | Circuit breaker for portfolio           | Liquidate everything if drawdown > `max_drawdown_exit_pct` |
| **Recovery Gate**         | Prevent whipsaw re-entry                | Resume trading only when DD recovers to 50% of threshold   |

---

## 7. Key Design Decisions

### Why Grid Trading?

Grid trading excels in **ranging/sideways markets** — it captures small price oscillations repeatedly. The "smart" layer adds trend-awareness to pause grid activity during strong directional moves where grid strategies historically underperform.

### Why Not a Pure Trend-Following Strategy?

Crypto markets spend ~60-70% of time in sideways consolidation. A pure trend-follower would generate many false signals and transaction costs. The grid approach profits from this consolidation, while the trend filters protect capital during the ~30% directional phases.

### Martingale Factor

The `martingale_factor` (default 2.5) increases order size for deeper grid levels. This means:

- Level 0 (closest to price): 1.0x base size
- Level 1: 2.5x base size
- Level 2: 6.25x base size

This **averages down aggressively** during dips, which is beneficial in bull markets but dangerous in sustained bearish moves — hence the strong downtrend filter that cuts the multiplier by 50% and limits orders to just 3 levels.

### Anti-Martingale Sizing

Despite the martingale-style depth factor, overall capital allocation **decreases as exposure grows** (via `size_reduction_factor`). This provides a natural brake that prevents the bot from going "all-in" during volatile periods.

---

## 8. Build & Deployment

### Build Command

```bash
# Compile TypeScript to dist/
npx tsc

# Or with a dedicated build script:
npm run build
```

### Cron Configuration

```bash
# Run every hour at minute 0
0 * * * * cd /path/to/trading-bots && node dist/smart-grid.js >> logs/smart-grid.log 2>&1
```

### Environment Variables (`.env`)

```env
API_KEY=your_binance_api_key
SECRET_KEY=your_binance_secret_key
ASSET='BTCUSDT'
TIME_FRAME='1h'
BALANCE=1000
```

---

## 9. Future Improvements

- [ ] **Volume Profile**: Use volume as additional confirmation for grid level placement
- [ ] **Multi-Timeframe Analysis**: Combine 1h signals with 4h/daily trend context
- [ ] **Adaptive TP/SL**: Use ATR-based dynamic stop distances instead of fixed percentages
- [ ] **Webhook Notifications**: Send Telegram/Discord alerts on trades
- [ ] **Portfolio Mode**: Support multiple trading pairs with cross-asset risk management
- [ ] **Machine Learning Overlay**: Train a classifier on past candle patterns to predict optimal grid density
