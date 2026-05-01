# 📈 HODL Portfolio Rebalancer & Compounder

An advanced algorithmic portfolio manager for cryptocurrency assets on Binance (Spot & Futures).

## 🚀 Key Features
- **Auto-Scale Growth Engine**: Automatically updates portfolio value to capture and reinvest gains.
- **Continuous Compounding**: Idle USDT (margin) ≥ $10 is automatically distributed across underweight assets.
- **Drift Rebalancing**: Automatically sells overweight positions and buys underweight ones to maintain target allocations.
- **ROI Harvesting**: Captures profits when individual assets exceed a set ceiling (e.g., 35%).
- **Leverage Support**: Native support for Binance Futures with margin-aware quantity calculations.
- **State Persistence**: Tracks portfolio history and high-water marks in a local JSON state store.

## 📁 Directory Structure
```
src/
├── stock-portfolio-manager/ # Main rebalancer module
│   ├── application/         # Use cases (Rebalance, Initialize)
│   ├── domain/              # Core engine (RebalancingEngine, Models)
│   ├── infrastructure/      # Adapters (Binance, File Store, Logger)
│   └── presentation/        # CLI (Dry Run, Live Rebalancer)
├── shared/                  # Common utilities and math
```

## 🛠 Setup
1. Clone the repository.
2. Install dependencies: `npm install`.
3. Configure your portfolio in `src/stock-portfolio-manager/infrastructure/config/config_longterm.json`.
4. Create a `.env` file with your Binance API keys.
5. Run a dry run: `npm run rebalancer:dry`.
6. Start the rebalancer loop: `npm run rebalancer:loop`.

## ⚖️ License
ISC
