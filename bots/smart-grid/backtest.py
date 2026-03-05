"""backtest.py
Backtesting engine for SmartGridBot.

Usage:
    python backtest.py

Requires a Binance API key only for live data fetching.  If the key is
not set the script will attempt to load data from a local CSV file
(btcusdt_1h.csv) if present, otherwise a small synthetic dataset is used
for demonstration purposes.
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

try:
    import requests
    _HAS_REQUESTS = True
except ImportError:
    _HAS_REQUESTS = False

try:
    import matplotlib.pyplot as plt
    import matplotlib.dates as mdates
    _HAS_MPL = True
except ImportError:
    _HAS_MPL = False

from smart_grid_bot import SmartGridBot


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CONFIG = {
    "symbol": "BTC/USDT",
    "initial_balance": 10_000.0,
    "grid_density": 100,
    "qty_per_order": 0.05,
    "volatility_lookback": 72,
    "trend_period": 50,
    "trend_threshold": 0.001,
    "take_profit_pct": 1.0,
    "stop_loss_pct": 2.0,
    "trailing_stop_pct": 0.5,
    "martingale_factor": 1.0,
}

BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines"
LOCAL_CSV = Path("btcusdt_1h.csv")
OUTPUT_CHART = Path("smart_backtest_results.png")


# ---------------------------------------------------------------------------
# Data helpers
# ---------------------------------------------------------------------------

def fetch_binance_klines(
    symbol: str = "BTCUSDT",
    interval: str = "1h",
    months: int = 6,
) -> pd.DataFrame:
    """Download historical klines from Binance REST API."""
    if not _HAS_REQUESTS:
        raise RuntimeError("requests library not installed")

    end_ms = int(time.time() * 1000)
    start_ms = int((datetime.utcnow() - timedelta(days=months * 30)).timestamp() * 1000)
    rows: list = []
    limit = 1000

    while start_ms < end_ms:
        resp = requests.get(
            BINANCE_KLINES_URL,
            params={
                "symbol": symbol,
                "interval": interval,
                "startTime": start_ms,
                "endTime": end_ms,
                "limit": limit,
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        if not data:
            break
        rows.extend(data)
        start_ms = int(data[-1][0]) + 1  # advance past last candle
        if len(data) < limit:
            break

    df = pd.DataFrame(rows, columns=[
        "open_time", "open", "high", "low", "close", "volume",
        "close_time", "quote_asset_volume", "num_trades",
        "taker_buy_base", "taker_buy_quote", "ignore",
    ])
    df["timestamp"] = pd.to_datetime(df["open_time"], unit="ms")
    for col in ("open", "high", "low", "close", "volume"):
        df[col] = df[col].astype(float)
    df.set_index("timestamp", inplace=True)
    df.to_csv(LOCAL_CSV)  # cache locally
    print(f"  Fetched {len(df)} candles from Binance and cached to {LOCAL_CSV}")
    return df


def load_data() -> pd.DataFrame:
    """Load OHLCV data: Binance API → local CSV → synthetic fallback."""
    if LOCAL_CSV.exists():
        print(f"  Loading cached data from {LOCAL_CSV}")
        df = pd.read_csv(LOCAL_CSV, index_col="timestamp", parse_dates=True)
        for col in ("open", "high", "low", "close", "volume"):
            df[col] = df[col].astype(float)
        return df

    if _HAS_REQUESTS:
        print("  Fetching data from Binance API...")
        try:
            return fetch_binance_klines()
        except Exception as exc:
            print(f"  Binance fetch failed: {exc}. Falling back to synthetic data.")

    print("  Generating synthetic BTC/USDT data for demonstration...")
    return _synthetic_btc_data()


def _synthetic_btc_data(hours: int = 4380) -> pd.DataFrame:
    """Very simple GBM-based synthetic BTC price series."""
    rng = np.random.default_rng(42)
    dt = 1 / (365 * 24)
    mu, sigma = 0.6, 0.8
    price = 40_000.0
    prices = [price]
    for _ in range(hours - 1):
        drift = (mu - 0.5 * sigma ** 2) * dt
        shock = sigma * math.sqrt(dt) * rng.standard_normal()
        price *= np.exp(drift + shock)
        prices.append(price)

    closes = np.array(prices)
    noise = rng.uniform(0.995, 1.005, size=hours)
    opens = np.roll(closes, 1) * noise
    highs = np.maximum(opens, closes) * rng.uniform(1.0, 1.01, size=hours)
    lows = np.minimum(opens, closes) * rng.uniform(0.99, 1.0, size=hours)
    idx = pd.date_range(end=datetime.utcnow(), periods=hours, freq="h")
    return pd.DataFrame(
        {"open": opens, "high": highs, "low": lows, "close": closes,
         "volume": rng.uniform(100, 2000, size=hours)},
        index=idx,
    )


# ---------------------------------------------------------------------------
# Backtest runner
# ---------------------------------------------------------------------------

def run_backtest(df: pd.DataFrame, config: dict) -> SmartGridBot:
    bot = SmartGridBot(**config)
    closes = df["close"].to_numpy()

    print(f"\n  Running backtest on {len(df)} candles...")
    for i, (ts, row) in enumerate(df.iterrows()):
        history = closes[: i + 1]
        bot.on_candle(
            timestamp=ts,
            open_=float(row["open"]),
            high=float(row["high"]),
            low=float(row["low"]),
            close=float(row["close"]),
            closes_history=history,
        )

    return bot


# ---------------------------------------------------------------------------
# Visualisation
# ---------------------------------------------------------------------------

def plot_results(df: pd.DataFrame, bot: SmartGridBot) -> None:
    if not _HAS_MPL:
        print("  matplotlib not installed — skipping chart generation.")
        return

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 8), sharex=True)
    fig.patch.set_facecolor("#0d1117")
    for ax in (ax1, ax2):
        ax.set_facecolor("#161b22")
        ax.tick_params(colors="white")
        ax.yaxis.label.set_color("white")
        ax.xaxis.label.set_color("white")
        ax.title.set_color("white")
        for spine in ax.spines.values():
            spine.set_edgecolor("#30363d")

    # BTC price
    ax1.plot(df.index, df["close"], color="#f0b429", linewidth=1.0, label="BTC/USDT Close")
    ax1.set_ylabel("Price (USDT)", color="white")
    ax1.set_title("BTC/USDT — Smart Grid Backtest", color="white", fontsize=13)
    ax1.legend(facecolor="#21262d", labelcolor="white")
    ax1.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f"${x:,.0f}"))

    # Equity curve
    eq_index = df.index[: len(bot.equity_curve) - 1]
    eq_values = bot.equity_curve[1 : len(eq_index) + 1]
    ax2.plot(eq_index, eq_values, color="#3fb950", linewidth=1.2, label="Portfolio Equity")
    ax2.axhline(bot.initial_balance, color="#8b949e", linestyle="--", linewidth=0.8,
                label=f"Initial Capital ${bot.initial_balance:,.0f}")
    ax2.set_ylabel("Equity (USDT)", color="white")
    ax2.set_xlabel("Date", color="white")
    ax2.legend(facecolor="#21262d", labelcolor="white")
    ax2.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f"${x:,.0f}"))
    ax2.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
    fig.autofmt_xdate()

    summary = bot.summary()
    annotation = (
        f"ROI: {summary['roi_pct']}%  |  "
        f"Profit: ${summary['total_profit']:,}  |  "
        f"Trades: {summary['total_trades']:,}  |  "
        f"Max DD: {summary['max_drawdown_pct']}%"
    )
    fig.text(0.5, 0.01, annotation, ha="center", color="#8b949e", fontsize=9)
    plt.tight_layout(rect=[0, 0.03, 1, 1])
    plt.savefig(OUTPUT_CHART, dpi=150, bbox_inches="tight")
    print(f"  Chart saved → {OUTPUT_CHART}")
    plt.close()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import math

    print("=" * 60)
    print(" Smart Grid Trading Bot — Backtester")
    print("=" * 60)

    df = load_data()
    print(f"  Data range : {df.index[0].date()} → {df.index[-1].date()}")
    print(f"  Total rows : {len(df):,}")

    bot = run_backtest(df, CONFIG)

    results = bot.summary()
    print("\n" + "=" * 60)
    print(" Performance Summary")
    print("=" * 60)
    for k, v in results.items():
        label = k.replace("_", " ").title()
        print(f"  {label:<25} {v}")

    plot_results(df, bot)
    print("\nDone.")
