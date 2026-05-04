# Strategies

Each `.json` file in this directory is a **Strategy Blueprint** (BPML schema).

The engine automatically discovers and runs **all** blueprints on startup.
No code changes are needed to add, remove, or update a strategy — just edit the JSON.

---

## Blueprint Schema

Full TypeScript interface: `packages/core/src/domain/models/StrategyBlueprint.ts`

### Top-level fields

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique ID (used for state file naming) |
| `name` | `string` | Human-readable name |
| `symbols` | `string[]` | Exchange symbols to trade |
| `defaultTimeframe` | `Timeframe` | Fallback timeframe |
| `indicators` | `IndicatorDeclaration[]` | Named indicator configs |
| `rules` | `StrategyRule[]` | Condition → action rules (priority order) |
| `loop.intervalSeconds` | `number` | How often the engine evaluates |
| `riskManagement` | `object` | Drawdown / position / daily-loss guards |

---

## Condition Syntax

Conditions can be nested AND/OR trees of arbitrary depth:

```json
{
  "logic": "AND",
  "conditions": [
    { "left": "rsi14",       "operator": ">",  "right": 50 },
    { "left": "price.close", "operator": ">",  "right": "sma200" },
    {
      "logic": "OR",
      "conditions": [
        { "left": "sma50", "operator": ">", "right": "sma200" },
        { "left": "rsi14", "operator": ">", "right": 60 }
      ]
    }
  ]
}
```

`left` / `right` can be:
- An **indicator id** declared in `indicators[]`
- `"price.close"` | `"price.open"` | `"price.high"` | `"price.low"`
- A **literal number**

---

## Supported Indicators

| Type | Params | Description |
|---|---|---|
| `SMA` | `period` | Simple Moving Average |
| `EMA` | `period` | Exponential Moving Average |
| `RSI` | `period` | Relative Strength Index |
| `ATR` | `period` | Average True Range |
| `VWAP` | — | Volume-Weighted Average Price |
| `VOLUME_MA` | `period` | Volume Moving Average |

To add a new indicator, add a `case` in `IndicatorService.compute()` — nothing else changes.

---

## Supported Actions

| Action | Description |
|---|---|
| `BUY` | Open a long position |
| `SELL` | Open a short / close long |
| `HOLD` | Do nothing this cycle |
| `CLOSE_ALL` | Close all open trades for this symbol |

---

## Rule Priority

Rules are evaluated in **ascending priority order** (lower number = higher priority).
The **first rule whose conditions are met** fires its action. Remaining rules are skipped.

---

## Size Modes

| `sizeMode` | `sizeValue` meaning |
|---|---|
| `pct_balance` | % of available balance |
| `fixed` | Fixed USDT amount |
| `kelly` | (coming soon) Kelly criterion sizing |

---

## Example

See `example-rsi-trend.json` and `example-ema-crossover.json` for full working examples.
