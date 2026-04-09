# Smart Rebalancer Bot — Binance Futures

## Overview

Equal-weight (20 %) perpetual futures portfolio rebalancer.

| Parameter | Value |
|---|---|
| Margin | $400 USDT |
| Leverage | 10x |
| Notional exposure | $4 000 USDT |
| Assets | SNDK, AMZN, NVDA, AAPL, TSM |
| Rebalance threshold | 5 % drift |
| Check interval | 24 h |

## Setup

```bash
pip install python-binance python-dotenv
```

Copy `.env.example` to `.env` and fill in your Binance Futures API credentials:

```
BINANCE_API_KEY=your_key
BINANCE_API_SECRET=your_secret
```

## Run

```bash
python rebalancer/rebalancer_bot.py
```

## Files

| File | Description |
|---|---|
| `rebalancer_bot.py` | Main bot logic (prices, portfolio state, rebalancing engine) |
| `config.json` | Strategy parameters (leverage, allocation, threshold, interval) |
| `README.md` | This file |

## ⚠️ Disclaimer

This is a **conceptual framework** for educational purposes only.  
Live trading involves significant financial risk. Always:
- Back-test thoroughly before deploying real capital
- Secure API keys (IP whitelist, Futures-only permission)
- Implement stop-loss and max-drawdown circuit breakers
- Comply with Binance API Terms of Service
