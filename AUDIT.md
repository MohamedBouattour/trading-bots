# Trading Bot Code Audit & Fixes

## 1. Confirmation Lookback Bug

**Root Cause:**
The RSI previous values slice included the current candle's RSI value in the lookback window. This meant the signal candle itself could satisfy its own confirmation rule (e.g., dipping below 40 on the exact same candle it triggered long), causing a lookahead bias during signal evaluation.
**Files Changed:**

- `src/momentum-sniper/domain/strategies/RsiEmaTrendStrategy.ts`
  **Before/After Behavior:**
- _Before:_ Lookback evaluated `recentRsi = rsiValues.slice(-lookback)`, which included `rsiValues[len - 1]`.
- _After:_ Lookback evaluates `recentRsi = prevRsiHistory.slice(-lookback)`, strictly isolating the previous 5 candles (excluding current) to test the `wasOversold / wasOverbought` flags.

## 2. RSI Crossover Time-Alignment

**Root Cause:**
RSI cross detection requires accurate historical boundaries. `IndicatorService.computeSMA` directly returning a scalar for a given sliding window requires careful input slicing to avoid aligning the current RSI against the previous SMA or vice versa.
**Files Changed:**

- `src/momentum-sniper/domain/strategies/RsiEmaTrendStrategy.ts`
  **Before/After Behavior:**
- _Before:_ `prevRsi` compared against `< prevRsiSma`.
- _After:_ Corrected logical operators `<=` and `>=` to ensure a true mathematical crossover (where previous was equal or below, and current is strictly above), preventing loose or missed crossover definitions. Evaluated cleanly on explicitly sliced historical inputs.

## 3. Position Sizing

**Root Cause:**
`BaseStrategyBot` calculated position allocation exclusively using `initial_balance`, disregarding portfolio growth or reduction over time. Compounding was broken.
**Files Changed:**

- `src/momentum-sniper/domain/bot/StrategyBots.ts`, `src/momentum-sniper/domain/bot/RsiEmaTrendBot.ts`
  **Before/After Behavior:**
- _Before:_ Position size was `this.initial_balance * (size_pct / 100)`.
- _After:_ Calculates target exposure using real-time calculated equity: `this._calculate_equity() * (size_pct / 100)`. Max exposure config parameter is properly passed down and honoured dynamically.

## 4. Undocumented Capital Haircut Removal

**Root Cause:**
An undocumented hard-coded `* 0.99` multiplier existed in margin budgeting inside `_open_position`.
**Files Changed:**

- `src/momentum-sniper/domain/bot/StrategyBots.ts`
  **Before/After Behavior:**
- _Before:_ Margin budget artificially shrunk by 1%, limiting max allocation.
- _After:_ Budget limits reflect exact mathematical formula resolving leverage and fee impact: `notional / price` respecting strictly `margin + fee <= balance`, permitting true 100% utilisation.

## 5. Max Drawdown Exit

**Root Cause:**
Drawdown from peak equity wasn't proactively monitored or capable of halting the strategy.
**Files Changed:**

- `src/momentum-sniper/domain/bot/StrategyBots.ts`, `src/momentum-sniper/domain/bot/RsiEmaTrendBot.ts`, `BotConfig.ts`
  **Before/After Behavior:**
- _Before:_ Bot kept trading regardless of absolute drawdown reached.
- _After:_ Explicitly tracks `_peak_equity`. If real-time equity drops beyond `max_dd_exit` percentage, halts new entries and instantly liquidates all remaining open positions.

## 6. Move SL to Break-Even & 7. Trailing Stop

**Root Cause:**
Logic didn't exist to transition fixed stop losses dynamically as price moved in favor.
**Files Changed:**

- `src/momentum-sniper/domain/bot/RsiEmaTrendBot.ts`
  **Before/After Behavior:**
- _Before:_ Stop losses were static.
- _After:_ Implemented BE shifts if price exceeds `move_sl_to_be_at_pct` favorability. Afterwards, continuously trails the highest high (or lowest low for shorts) at `trailing_stop` % away to lock in profits.

## 8. Exit on Trend Reversal

**Root Cause:**
Positions didn't respect market regime changes that invalidated the initial trend setup, leading to long slow losses.
**Files Changed:**

- `src/momentum-sniper/domain/bot/RsiEmaTrendBot.ts`
  **Before/After Behavior:**
- _Before:_ Trend EMA was only used as an entry filter.
- _After:_ Evaluates the current close against the same EMA filter internally. Exits LONGs if price closes below EMA; exits SHORTs if price closes above.

## 9. Same-Candle Execution Realism

**Root Cause:**
If a position opened on candle N, the same OHLCV values of candle N were instantaneously used to test for SL/TP hits. This is physically impossible for most real world entries and generated lookahead bias.
**Files Changed:**

- `src/momentum-sniper/domain/bot/RsiEmaTrendBot.ts`, `src/momentum-sniper/application/usecases/RunBacktestUseCase.ts`
  **Before/After Behavior:**
- _Before:_ `on_candle` opened positions and subsequently in the same or next tick allowed the extreme boundaries of the setup candle to register as exits. Missing close validation on the terminal chunk from the Runner data block.
- _After:_ Attached `opened_at_candle` to positions. Exit management purposefully skips all SL/TP evaluations if `this._candle_counter == opened_at_candle`. Handled filtering out incomplete data chunks directly from `RunBacktestUseCase` to prevent premature execution.

## 10. Robust Configuration Wiring

**Root Cause:**
Bot execution heavily relied on `any` cast bypassing to grab misnamed `.env` configurations that didn't match the model object interface.
**Files Changed:**

- `src/models/BotConfig.ts`, `.env.example`, `RsiEmaTrendBot.ts`
  **Before/After Behavior:**
- _Before:_ Untyped mappings forced `(bot as any).config`.
- _After:_ Fully explicit configuration properties tied securely to runtime initializations. `BotConfig` supports `max_dd_exit`, `trailing_stop`, `move_sl_to_be_at_pct`, etc natively.
