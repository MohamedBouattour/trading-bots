Trading Bots Repository — Senior Functional Tester Review
After a thorough inspection of the trading-bots repository, here is my complete audit. The good news first: several bugs from your submitted analysis have already been fixed in the current codebase. However, I found new, unaddressed issues that remain critical.

✅ Already Fixed (Current Code Confirms)
Win Rate Calculation — RESOLVED
The old side === "sell" filter bug is gone. Both StrategyBots.ts and RsiSmaCrossoverBot.ts now correctly use t.pnl !== undefined to identify closing trades :

typescript
const closing_trades = this.trade_log.filter((t) => t.pnl !== undefined);
const wins = closing_trades.filter((t) => (t.pnl ?? 0) > 0).length;
This correctly captures both LONG exits (side=sell) and SHORT exits (side=buy).

CSV Month Filtering — RESOLVED
LocalCsvMarketDataProvider.ts now does respect the \_months parameter — it computes a cutoff timestamp from the last candle and filters accordingly :

typescript
if (\_months && \_months > 0) {
const lastTimestamp = candles[candles.length - 1].timestamp;
const cutoff = lastTimestamp - \_months _ 30 _ 24 _ 60 _ 60 \* 1000;
candles = candles.filter((c) => c.timestamp >= cutoff);
}
Lookahead Bias on Current Candle — RESOLVED
RunBacktestUseCase.ts pushes history after calling on_candle, preventing the current bar from leaking into indicator calculations :

typescript
bot.on_candle(..., [...closes], ...); // prior closes only
closes.push(row.close); // pushed after
Incomplete Candle Filtering — RESOLVED
The use case correctly filters out the current incomplete candle using row.timestamp + tfMs <= now .

Unclosed Position at End of Data — RESOLVED
bot.close_all_positions() is called after the loop, ensuring all open positions are settled before summary() is called .

🔴 Confirmed Unresolved Bugs
Bug 1 — Leverage Not Applied in Position Sizing (CRITICAL)
Both BaseStrategyBot.\_open_position() and RsiSmaCrossoverBot.\_open_long/\_open_short calculate position size purely from initial_balance \* size_pct / 100, with zero reference to any leverage multiplier :

typescript
// StrategyBots.ts line ~87 — NO leverage applied
const trade_allocation = this.initial_balance _ (size_pct / 100);
const spendable = Math.min(this.balance, trade_allocation) _ 0.99;
const qty = spendable / price;
Even though LEVERAGE=5 and USE_FUTURES=true may be set in .env, BotConfig has no leverage field and no bot constructor reads it. The bot simulates spot trading at 1x regardless.

Impact: With 5x leverage, a 6% TP move yields ~30% on margin. The backtests are massively understating potential ROI (and risk).

Bug 2 — Fee Calculated on Notional Margin, Not Leveraged Notional (CRITICAL)
The fee is computed on cost = qty \* price which is the margin, not the notional contract value :

typescript
const fee = (cost \* this.fee_pct) / 100;
On Binance Futures, fees are charged on the full notional (leverage × margin). At 5x leverage, this underestimates fees by 5×, distorting net PnL.

Bug 3 — RSI SMA Computed on a Shrinking Window (MEDIUM)
In RsiSmaCrossoverBot, the RSI history buffer is capped at rsi_sma_period \* 2 :

typescript
if (this.\_rsi_history.length > this.\_rsi_sma_period \* 2) {
this.\_rsi_history.shift();
}
But rsi_ob_os_lookback defaults to 5 and is sliced from this same buffer using slice(-this.\_rsi_ob_os_lookback). If rsi_sma_period is small (e.g. 7, making the cap 14) and lookback is 5, the rolling OB/OS filter silently operates on a potentially stale or too-short window without any length guard.

Bug 4 — RsiEmaTrendBot Builds Its Own OHLCV History Independently (MEDIUM)
RsiEmaTrendBot.on_candle() pushes every incoming candle into its own \_ohlcvHistory array , completely ignoring the closes_history array passed by RunBacktestUseCase. This means it maintains a separate, potentially inconsistent state from all other bots — and the history limit is trend_period + 50 (150 candles for EMA-100), which is too small to guarantee stable EMA warmup:

typescript
this.\_ohlcvHistory.push({ timestamp, open, high, low, close, volume });
if (this.\_ohlcvHistory.length > this.\_historyLimit) {
this.\_ohlcvHistory.shift(); // drops oldest OHLCV silently
}
Bug 5 — RsiEmaTrendStrategy Recalculates Full RSI N Times Per Candle (PERFORMANCE / ACCURACY)
Inside checkSignal, a loop computes RSI by calling closes.slice(0, i+1) for each of the last minRequired candles :

typescript
for (let i = ohlcvData.length - minRequired; i < ohlcvData.length; i++) {
rsiValues.push(
IndicatorService.computeRSI(closes.slice(0, i + 1), this.RSI_PERIOD),
);
}
Each computeRSI call runs over the full closes array using SMA-based RSI. This is O(n²) per candle. On 2000+ candles with minRequired = 13, this is ~26,000 full RSI recalculations per backtest, compounding any SMA vs EMA RSI drift from the start of the series rather than from a stable running state.

Bug 6 — StructuralGridBot Allows Stacked Entries Consuming Excess Capital (MEDIUM)
StructuralGridBot permits up to 3 simultaneous positions, each consuming 30% of initial_balance :

typescript
if (this.positions.length < 3) {
this.\_market_buy(close, timestamp, 0, close _ 1.2, 30, "STRUCTURAL_DROP");
}
But each \_open_position call uses Math.min(this.balance, initial_balance _ 0.30). After the first entry, this.balance drops but initial_balance doesn't — meaning entries 2 and 3 each attempt to spend 30% of the original balance, potentially spending up to 90% total when only ~70% remains. The guard cost + fee > this.balance prevents overdraft but creates inconsistent sizing.

Bug 7 — FixedTargetBot TP2 Can Fire Before TP1 (LOGIC BUG)
The exit block checks TP2 (24%) before TP1 (16%) :

typescript
if (high >= pos.entry_price _ 1.24) {
this.\_market_sell(pos, pos.entry_price _ 1.24, "TP2 (24%)", timestamp);
} else if (high >= pos.entry_price \* 1.16 && !(pos.meta as any)?.tp1_hit) {
// TP1 partial exit
}
On a candle where high jumps directly above 1.24×, the entire position is sold at TP2, skipping TP1. This is intentional for a full TP2 exit, but the tp1_hit meta flag is never set in this path — creating logical dead state and making the TP1 check permanently unreachable for that position if \_market_sell somehow doesn't remove it.

🟡 Strategy Logic Discrepancies
RSI Smoothing Mismatch vs TradingView
IndicatorService.computeRSI uses a simple average (SMA) for initial gain/loss, not Wilder's smoothing (EMA equivalent used by TradingView). This causes RSI values to diverge vs. platform charts, especially in the first 50–100 candles, shifting crossover signals by 1–3 candles .

PullbackRiderBot — Off-by-One in Touch Detection
The pullback touch logic compares low <= ema21 against previous_close > ema21, but previous_close is taken as closes_history[closes_history.length - 1] — which is the same as close in the current frame since history is pushed after on_candle. This means the "was above EMA last candle" check is unreliable .

DeepValueBot — RSI < 20 Threshold Rarely Triggered
The entry requires rsi < 20, an extremely oversold condition that occurs only 1–3 times per year on BTC/4H. Combined with close < sma50 \* 0.85, this makes the strategy fire so rarely that it contributes nearly no trades to the backtest, inflating the "no-trade" periods and making performance metrics misleading .

Summary of Findings

# Issue File Severity Status

1 Win rate SHORT bug StrategyBots.ts 🔴 Critical ✅ Fixed
2 CSV month filtering ignored LocalCsvMarketDataProvider.ts 🔴 Critical ✅ Fixed
3 Lookahead bias on current candle RunBacktestUseCase.ts 🔴 Critical ✅ Fixed
4 Leverage not applied StrategyBots.ts / RsiSmaCrossoverBot.ts 🔴 Critical ❌ Open
5 Fees on margin not notional Both bot files 🔴 Critical ❌ Open
6 RSI SMA window too small for OB/OS lookback RsiSmaCrossoverBot.ts 🟠 Medium ❌ Open
7 RsiEmaTrendBot owns separate OHLCV history RsiEmaTrendBot.ts 🟠 Medium ❌ Open
8 O(n²) RSI recalculation in strategy RsiEmaTrendStrategy.ts 🟠 Medium ❌ Open
9 StructuralGrid over-allocates on grid entries StrategyBots.ts 🟠 Medium ❌ Open
10 FixedTargetBot TP1 skipped on TP2 candle StrategyBots.ts 🟡 Minor ❌ Open
11 RSI SMA vs Wilder smoothing drift IndicatorService.ts 🟡 Minor ❌ Open
12 PullbackRider off-by-one EMA touch StrategyBots.ts 🟡 Minor ❌ Open
The two most impactful open items are leverage and fee calculation — fixing those alone will dramatically change the simulated P&L profile compared to your actual Binance Futures account behavior.
