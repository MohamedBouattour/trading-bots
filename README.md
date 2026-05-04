# trading-bots v2 — Metadata-Driven Strategy Engine

## Architecture

This is a **monorepo** (npm workspaces) with three packages:

| Package | Purpose |
|---|---|
| `packages/core` | Domain models, ports (interfaces), indicator math, condition evaluator |
| `packages/engine` | Generic runtime — discovers `strategies/*.json` and executes them |
| `dashboard` | React + Vite UI showing equity curves, trades, and a blueprint editor |

## The Core Idea — BPML (Blueprint Metadata Language)

Strategies are **pure JSON** — no code. The engine interprets them generically.

```json
{
  "id": "rsi-trend-v1",
  "indicators": [{"id": "rsi14", "type": "RSI", "params": {"period": 14}}],
  "rules": [{
    "conditionGroup": {"logic": "AND", "conditions": [{"left": "rsi14", "operator": ">", "right": 50}]},
    "action": "BUY"
  }]
}
```

## Quick Start

```bash
npm install
cp .env.example .env  # fill in your Binance keys
npm run dev
```

## Adding a Strategy

1. Create `strategies/my-strategy.json` using the [BPML schema](strategies/README.md)
2. Engine picks it up automatically on next start — **zero code changes**

## Project Structure

```
trading-bots/
├── packages/
│   ├── core/          ← @trading-bots/core
│   └── engine/        ← @trading-bots/engine
├── dashboard/         ← React dashboard
├── strategies/        ← BPML JSON blueprints
└── states/            ← runtime state per strategy (auto-generated)
```
