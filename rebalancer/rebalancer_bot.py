"""
Smart Rebalancer Bot — Binance USDⓈ-Margined Futures
Margin : $400 USDT  |  Leverage : 10x  |  Notional : $4 000 USDT

Strategy
--------
- Equal-weight (20 %) across SNDK, AMZN, NVDA, AAPL, TSM perpetual contracts
- Threshold-based rebalance  : triggers when any asset drifts > 5 % from target
- Time-based check           : every 24 h (configurable)

DISCLAIMER
----------
This is a conceptual framework for educational purposes.
Live trading requires proper API-key security, extensive back-testing,
risk management (stop-loss, max-drawdown circuit breakers), and full
compliance with Binance's API Terms of Service.
"""

import json
import time
import logging
from typing import Dict, Tuple

# Uncomment for live trading:
# from binance.client import Client
# from binance.enums import FUTURE_ORDER_TYPE_MARKET, SIDE_BUY, SIDE_SELL

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

CONFIG_PATH = "rebalancer/config.json"


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def load_config(config_path: str = CONFIG_PATH) -> dict:
    with open(config_path, "r") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Price feed  (replace stub with live Binance Futures REST call)
# ---------------------------------------------------------------------------

def get_current_prices(symbols: list[str]) -> Dict[str, float]:
    """
    Live implementation:
        client = Client(api_key, api_secret)
        tickers = client.futures_symbol_ticker()
        return {t['symbol']: float(t['price']) for t in tickers if t['symbol'] in symbols}
    """
    # --- STUB prices (April 9 2026 snapshot) --- replace with live call ---
    stub: Dict[str, float] = {
        "SNDKUSDT": 827.01,
        "AMZNUSDT": 225.32,
        "NVDAUSDT": 183.73,
        "AAPLUSDT": 259.97,
        "TSMUSDT":  367.48,
    }
    return {s: stub[s] for s in symbols if s in stub}


# ---------------------------------------------------------------------------
# Leverage management
# ---------------------------------------------------------------------------

def set_leverage(client, symbols: list[str], leverage: int) -> None:
    """
    Live implementation:
        for symbol in symbols:
            client.futures_change_leverage(symbol=symbol, leverage=leverage)
    """
    logger.info("[STUB] Leverage set to %dx for: %s", leverage, symbols)


# ---------------------------------------------------------------------------
# Portfolio calculations
# ---------------------------------------------------------------------------

def calculate_initial_positions(
    total_notional: float,
    target_allocation: Dict[str, float],
    prices: Dict[str, float],
) -> Dict[str, float]:
    """Return the number of contracts (units) for each symbol at inception."""
    holdings: Dict[str, float] = {}
    for symbol, weight in target_allocation.items():
        price = prices.get(symbol, 0)
        if price > 0:
            holdings[symbol] = (total_notional * weight) / price
    return holdings


def calculate_portfolio_state(
    holdings: Dict[str, float],
    prices: Dict[str, float],
) -> Tuple[float, Dict[str, float]]:
    """Return (total_value, weight_per_asset)."""
    total_value = sum(
        units * prices.get(sym, 0) for sym, units in holdings.items()
    )
    weights: Dict[str, float] = {}
    for sym, units in holdings.items():
        asset_value = units * prices.get(sym, 0)
        weights[sym] = asset_value / total_value if total_value > 0 else 0
    return total_value, weights


# ---------------------------------------------------------------------------
# Rebalancing engine
# ---------------------------------------------------------------------------

def rebalance(
    config: dict,
    holdings: Dict[str, float],
    prices: Dict[str, float],
) -> Dict[str, float]:
    """
    Computes required trades and returns updated holdings.

    For each asset whose weight deviates > threshold from target:
      - Over-weight  → SELL excess notional
      - Under-weight → BUY deficit notional

    Live order execution:
        client.futures_create_order(
            symbol=symbol,
            side=SIDE_SELL or SIDE_BUY,
            type=FUTURE_ORDER_TYPE_MARKET,
            quantity=round(qty, precision),
        )
    """
    total_notional: float = config["total_notional"]
    target_allocation: Dict[str, float] = config["target_allocation"]
    threshold: float = config["rebalance_threshold"]

    total_value, current_weights = calculate_portfolio_state(holdings, prices)
    logger.info("Portfolio notional value : $%.2f", total_value)

    needs_rebalance = False
    for sym, target_w in target_allocation.items():
        current_w = current_weights.get(sym, 0)
        drift = abs(current_w - target_w)
        logger.info(
            "  %-12s  current=%.2f%%  target=%.2f%%  drift=%.2f%%",
            sym, current_w * 100, target_w * 100, drift * 100,
        )
        if drift > threshold:
            needs_rebalance = True

    if not needs_rebalance:
        logger.info("Portfolio balanced — no trades required.")
        return holdings

    logger.info("Rebalancing triggered …")
    updated_holdings = dict(holdings)
    for sym, target_w in target_allocation.items():
        target_value = total_notional * target_w          # use configured notional
        current_value = holdings.get(sym, 0) * prices.get(sym, 0)
        price = prices.get(sym, 0)
        if price <= 0:
            logger.warning("No price for %s — skipping.", sym)
            continue

        current_w = current_weights.get(sym, 0)
        if abs(current_w - target_w) <= threshold:
            continue

        delta_usdt = target_value - current_value
        delta_units = delta_usdt / price

        if delta_usdt > 0:
            logger.info("  BUY  %-12s  +$%.2f  (+%.6f units)", sym, delta_usdt, delta_units)
            # client.futures_create_order(symbol=sym, side=SIDE_BUY,  ...)
        else:
            logger.info("  SELL %-12s  -$%.2f  (-%.6f units)", sym, -delta_usdt, -delta_units)
            # client.futures_create_order(symbol=sym, side=SIDE_SELL, ...)

        updated_holdings[sym] = target_value / price   # reflect new position

    return updated_holdings


# ---------------------------------------------------------------------------
# Entry-point
# ---------------------------------------------------------------------------

def main() -> None:
    config = load_config()
    leverage: int = config["leverage"]
    total_notional: float = config["total_notional"]   # margin * leverage
    symbols: list[str] = list(config["target_allocation"].keys())
    interval: int = config["rebalance_interval_seconds"]

    logger.info(
        "Smart Rebalancer Bot starting  |  margin=$%.0f  leverage=%dx  notional=$%.0f",
        config["margin_balance"], leverage, total_notional,
    )

    # --- Live client initialisation (uncomment for real trading) ---
    # client = Client(api_key=os.getenv('BINANCE_API_KEY'),
    #                 api_secret=os.getenv('BINANCE_API_SECRET'))
    # client.futures_change_position_mode(dualSidePosition=False)  # one-way mode
    # set_leverage(client, symbols, leverage)

    prices = get_current_prices(symbols)
    holdings = calculate_initial_positions(
        total_notional, config["target_allocation"], prices
    )

    logger.info("Initial positions:")
    for sym, units in holdings.items():
        notional = units * prices.get(sym, 0)
        logger.info("  %-12s  %.6f units  (~$%.2f notional)", sym, units, notional)

    # --- Main loop ---
    while True:
        try:
            prices = get_current_prices(symbols)
            holdings = rebalance(config, holdings, prices)
        except Exception as exc:  # noqa: BLE001
            logger.error("Rebalance cycle error: %s", exc)
        logger.info("Next check in %d seconds …", interval)
        time.sleep(interval)


if __name__ == "__main__":
    main()
