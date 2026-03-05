# 🤖 Trading Bots Monorepo

A collection of algorithmic trading bots for cryptocurrency markets, designed and backtested with real historical data.

## 📦 Bots

| Bot                             | Strategy                       | Pair     | Target ROI |
| ------------------------------- | ------------------------------ | -------- | ---------- |
| [smart-grid](./src/smart-grid/) | Dynamic Grid + Trend Following | BTC/USDT | 20–30%+    |

## 🗂️ Structure (Clean Architecture)

```
trading-bots/
├── src/
│   ├── models/            # Domain models (Order, Position, Trade, etc.)
│   ├── shared/            # Shared utilities and indicators
│   └── smart-grid/        # Smart adaptive grid trading bot module
│       ├── application/    # Use cases (Backtest logic)
│       ├── domain/        # Core business logic (Bot state management)
│       ├── infrastructure/ # External services (Binance API, HTML Reporting)
│       ├── ports/         # Interfaces for decoupling
│       └── presentation/  # CLI entry points
├── .env                  # API keys and configuration
├── package.json
└── tsconfig.json
```

## 🚀 Getting Started

1. **Install Dependencies**

   ```bash
   npm install
   ```

2. **Configure Environment**
   Create a `.env` file based on `.env.example`:

   ```env
   API_KEY=your_binance_api_key
   SECRET_KEY=your_binance_secret_key
   ASSET=BTC/USDT
   BALANCE=10000
   ```

3. **Run Backtest**

   ```bash
   npm run backtest
   ```

4. **Execute Live Orders (Test Mode)**
   ```bash
   npm run open-order
   ```

## 📄 Principles

This project follows **SOLID** principles and **Clean Architecture**:

- **Single Responsibility**: Each class and module has one purpose.
- **Dependency Inversion**: High-level modules don't depend on low-level modules; both depend on abstractions (ports).
- **Separation of Concerns**: Decoupled domain, application, infrastructure, and presentation layers.

## ⚠️ Disclaimer

All bots in this repository are for educational and research purposes only. Backtested performance does not guarantee future results. Cryptocurrency trading involves significant risk.

## 📄 License

MIT
