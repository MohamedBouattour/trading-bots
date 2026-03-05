# 🤖 Trading Bots Monorepo

A collection of algorithmic trading bots for cryptocurrency markets, designed and backtested with real historical data.

## 📦 Bots

| Bot | Strategy | Pair | Target ROI |
|-----|----------|------|------------|
| [smart-grid](./bots/smart-grid/) | Dynamic Grid + Trend Following | BTC/USDT | 20–30%+ |

## 🗂️ Structure

```
trading-bots/
└── bots/
    └── smart-grid/         # Smart adaptive grid trading bot
        ├── README.md        # Full strategy report
        ├── smart_grid_bot.py
        ├── backtest.py
        └── requirements.txt
```

## 🚀 Getting Started

```bash
# Clone the repo
git clone https://github.com/MohamedBouattour/trading-bots.git
cd trading-bots

# Navigate to the desired bot
cd bots/smart-grid

# Install dependencies
pip install -r requirements.txt

# Run the backtest
python backtest.py
```

## ⚠️ Disclaimer

All bots in this repository are for educational and research purposes only. Backtested performance does not guarantee future results. Cryptocurrency trading involves significant risk.

## 📄 License

MIT
