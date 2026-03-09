# Momentum Sniper Trading Bot

An advanced "One-Shot" momentum trading bot for cryptocurrency spot markets (Binance).

## 🚀 Key Features
- **One-Shot Execution**: Concentrates capital on high-probability signals.
- **Trend-Following**: Aligns entries with long-term market momentum (SMA 200).
- **Multiple Strategies**: Includes implementations for Pullbacks, Crossovers, and Mean Reversion.
- **Dynamic Risk Management**: Integrated Stop Loss, Take Profit, and Trailing Stop.
- **Backtesting & Optimization**: Built-in tools to verify and fine-tune parameters using historical data.
- **State Persistence**: Saves bot state between cron runs to maintain continuity.

## 📁 Directory Structure
```
src/
├── momentum-sniper/    # Main bot module
│   ├── application/    # Use cases (Backtest logic)
│   ├── domain/         # Core bot logic (MomentumBot)
│   ├── infrastructure/ # External services (Binance, Market Data, Reporting)
│   ├── ports/          # Interfaces
│   └── presentation/   # CLI entry points
├── models/             # Shared data models (Position, Order, BotConfig)
└── shared/             # Common utilities and indicators
```

## 🛠 Setup
1. Clone the repository.
2. Install dependencies: `npm install`.
3. Create a `.env` file based on `.env.example`.
4. Run a backtest: `npm run backtest`.

## 📈 Performance Summary (Example)
The **Momentum Sniper** (SMA 5/10 Breakout) achieved:
- **ROI**: High variability based on market trend.
- **Win Rate**: ~60% in trending markets.
- **Timeframe**: Optimized for 1h cycles.

## ⚖️ License
ISC
