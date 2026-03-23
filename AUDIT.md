🔴 Active Bugs & Nonconformities (New Findings)
BUG-01 — BotConfig Field Name Collision / Ambiguity
BotConfig.ts has two separate drawdown fields: max_drawdown_exit_pct and max_dd_exit, and two exposure fields: max_exposure_pct and max_exposure. RsiEmaTrendBot reads config.max_dd_exit and config.max_exposure, but the .env env-wiring (not shown in the shared file) must map MAX_DD_EXIT and MAX_EXPOSURE to these exact fields — if any infrastructure layer maps to the old field names (max_drawdown_exit_pct, max_exposure_pct), the bot silently falls back to 0 and 100 defaults, disabling drawdown protection with no error. This is a critical silent failure path.

BUG-02 — EMA_PERIOD Accessed via (this.\_strategy as any).EMA_PERIOD on Private Field
In RsiEmaTrendBot.ts, get_config() accesses strategy internals via (this.\_strategy as any).EMA_PERIOD, RSI_PERIOD, SL_PCT, etc. These fields are declared private readonly in RsiEmaTrendStrategy. This breaks TypeScript's encapsulation contract and will silently return undefined in any environment that uses property mangling (e.g., esbuild/terser minification in production), producing a corrupt config serialization — critically wrong in live trading mode.

BUG-03 — \_exit_on_reversal EMA Recomputed but Only on the Current Candle
When EXIT_ON_TREND_REVERSAL=false (your .env), emaVal is correctly skipped. However when enabled, the EMA is recomputed from this.\_ohlcvHistory.map(c => c.close) at position-management time, after the history was already appended with the current candle. The reversal exit thus uses the same EMA as the entry signal check, which is mathematically correct, but the comparison is close < emaVal (strict less-than). A close exactly at the EMA does not trigger an exit — this is a spec gap since the strategy doc says "price closes below EMA." While directionally correct, an equality edge case can leave a position open when price stalls exactly at EMA.

BUG-04 — close_all_positions Double-Counts Equity on Peak Update
In StrategyBots.ts, close_all_positions calls \_market_sell for each position (which adds margin+PnL back to this.balance), then does:

ts
const equity = this.balance;
if (equity > this.\_peak_equity) this.\_peak_equity = equity;
this.equity_curve[this.equity_curve.length - 1] = equity;
It overwrites the last equity_curve entry rather than pushing a new one. If \_update_equity is called right after (which it is in on_candle's halted DD path), the equity_curve gets a duplicate equity point for the same candle, inflating the curve length by 1 and corrupting the summary() period calculation which relies on this.\_end_timestamp.

BUG-05 — Fee Applied Asymmetrically (Entry vs. Exit)
In \_open_position, fee is charged as: fee = (notional _ fee_pct) / 100 and subtracted from balance. In \_market_sell, exit fee is: fee_exit = (notional_exit _ fee_pct) / 100. This is correct structurally, but the entry fee uses notional (leveraged notional) while comments say "fee per trade (entry/exit) = 0.04%". Binance Futures charges 0.04% on notional — so the math is aligned, but fee_pct in .env is set to 0.04 which is interpreted as 0.04% (i.e., notional _ 0.04 / 100 = notional _ 0.0004). This is correct. However, no round-trip validation test exists confirming the net PnL formula accounts for both legs precisely — a test with known entry/exit prices and quantity should assert exact expected balance.

BUG-06 — \_last_trade_candle Blocks Entry on Same Candle as SL/TP Exit
In RsiEmaTrendBot.on_candle, after an exit via \_market_sell, the code sets this.\_last_trade_candle = this.\_candle_counter. Later in step 2 (Entry Logic), there is this guard:

ts
this.\_last_trade_candle !== this.\_candle_counter
This prevents re-entry on the same candle a trade was closed, which is reasonable. However, this also blocks entry if a signal fires simultaneously with a SL exit (which is a valid mean-reversion scenario in the spec). The spec says nothing about a cooldown period after exit — this is an undocumented strategy restriction that reduces trade count and could account for the 77-trade figure diverging from a pure rule-based replay.

BUG-07 — fromJSON Does Not Restore \_ohlcvHistory
RsiEmaTrendBot.fromJSON restores \_ohlcvHistory from raw.ohlcv_history, but toJSON() in StrategyBots.ts does not serialize \_ohlcvHistory. This means any live bot that is saved and restored will have an empty OHLCV history, causing the strategy to return noSignal until the history re-warms (minimum EMA_PERIOD + RSI_PERIOD + RSI_SMA_PERIOD + 10 = 124 candles = ~20 days on 4H). This is a critical live trading defect with silent failure.

🟡 Strategy Spec Conformity Gaps

# Spec Requirement Code Behavior Status

# Spec Requirement Code Behavior Status

S1 Entry at close price of signal candle entryPrice = currentCandle.close ✅ Compliant
S2 LONG: RSI crosses above SMA prevRsi <= prevRsiSma && currentRsi > currentRsiSma ✅ Compliant
S3 SHORT: RSI crosses below SMA prevRsi >= prevRsiSma && currentRsi < currentRsiSma ✅ Compliant
S4 Oversold confirmation: RSI < 40 in last 5 candles (excluding current) prevRsiHistory.slice(-5) ✅ Compliant
S5 SL = 1.5%, TP = 6.0% Correctly wired from .env via BotConfig ✅ Compliant
S6 MAX_EXPOSURE=100 uses full equity equity \* (size_pct/100) ✅ Compliant
S7 Fee = 0.04% on notional per leg Applied on open and close ✅ Compliant
S8 Only one position at a time positions.length === 0 guard ✅ Compliant
S9 TRAILING_STOP=0.0 and MOVE_SL_TO_BE=0.0 should be no-ops > 0 guards skip both ✅ Compliant
S10 EXIT_ON_TREND_REVERSAL=false should be no-op if (this.\_exit_on_reversal) guards ✅ Compliant
🟠 Priority Recommendations
CRITICAL — BUG-07: Add ohlcv_history to toJSON() serialization immediately — this breaks live bot resume.

CRITICAL — BUG-01: Audit the infrastructure env-wiring layer (not in repo) to confirm MAX_DD_EXIT maps to max_dd_exit not max_drawdown_exit_pct. Add a startup validation that throws if max_dd_exit is undefined when MAX_DD_EXIT > 0.

HIGH — BUG-02: Expose EMA_PERIOD, RSI_PERIOD, etc. via a public getParams() method on RsiEmaTrendStrategy instead of (as any) casting.

HIGH — BUG-04: In close_all_positions, call this.equity_curve.push(equity) instead of overwriting the last entry.

MEDIUM — BUG-06: Document the same-candle re-entry block explicitly in the strategy spec, or make it configurable via a cooldown_candles config parameter.

LOW — BUG-05: Add a unit test asserting exact round-trip PnL for a known trade to lock in fee correctness.
