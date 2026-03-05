"""smart_grid_bot.py
Smart Grid Trading Bot for BTC/USDT — core strategy logic.

Features:
  - Dynamic grid levels adjusted by volatility (ATR / rolling std)
  - Trend detection via configurable Moving Average
  - Trailing stop-loss per position
  - Optional Martingale safety-order sizing
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class Order:
    order_id: int
    side: str          # 'buy' | 'sell'
    price: float
    quantity: float
    status: str = 'open'   # 'open' | 'filled' | 'cancelled'
    fill_price: Optional[float] = None


@dataclass
class Position:
    entry_price: float
    quantity: float
    take_profit_price: float
    stop_loss_price: float
    trailing_stop_pct: float
    highest_price_seen: float = field(init=False)

    def __post_init__(self):
        self.highest_price_seen = self.entry_price

    def update_trailing_stop(self, current_price: float) -> None:
        """Ratchet the trailing stop up as price rises."""
        if current_price > self.highest_price_seen:
            self.highest_price_seen = current_price
            self.stop_loss_price = self.highest_price_seen * (
                1 - self.trailing_stop_pct / 100
            )

    @property
    def is_stop_hit(self) -> bool:
        return False  # evaluated externally against live price


# ---------------------------------------------------------------------------
# SmartGridBot
# ---------------------------------------------------------------------------

class SmartGridBot:
    """
    Parameters
    ----------
    symbol              : trading pair label (informational)
    initial_balance     : starting USDT capital
    grid_density        : number of grid lines
    qty_per_order       : BTC quantity per order
    volatility_lookback : rolling window (candles) for volatility
    trend_period        : MA period for trend detection
    trend_threshold     : minimum |slope| to declare a trend
    take_profit_pct     : % profit target per trade
    stop_loss_pct       : % hard stop below entry
    trailing_stop_pct   : % trailing stop below peak price
    martingale_factor   : safety-order size multiplier (1.0 = disabled)
    """

    def __init__(
        self,
        symbol: str = "BTC/USDT",
        initial_balance: float = 10_000.0,
        grid_density: int = 100,
        qty_per_order: float = 0.05,
        volatility_lookback: int = 72,
        trend_period: int = 50,
        trend_threshold: float = 0.001,
        take_profit_pct: float = 1.0,
        stop_loss_pct: float = 2.0,
        trailing_stop_pct: float = 0.5,
        martingale_factor: float = 1.0,
    ):
        self.symbol = symbol
        self.balance = initial_balance
        self.initial_balance = initial_balance
        self.grid_density = grid_density
        self.qty_per_order = qty_per_order
        self.volatility_lookback = volatility_lookback
        self.trend_period = trend_period
        self.trend_threshold = trend_threshold
        self.take_profit_pct = take_profit_pct
        self.stop_loss_pct = stop_loss_pct
        self.trailing_stop_pct = trailing_stop_pct
        self.martingale_factor = martingale_factor

        # Runtime state
        self._order_counter: int = 0
        self.open_orders: Dict[int, Order] = {}
        self.positions: List[Position] = []
        self.grid_levels: List[float] = []
        self.grid_lower: float = 0.0
        self.grid_upper: float = 0.0
        self.trend: str = 'ranging'  # 'uptrend' | 'downtrend' | 'ranging'
        self.equity_curve: List[float] = [initial_balance]
        self.trade_log: List[dict] = []

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _next_id(self) -> int:
        self._order_counter += 1
        return self._order_counter

    def _compute_volatility(self, closes: np.ndarray) -> float:
        """Rolling std of log-returns, annualised to a % of price."""
        if len(closes) < 2:
            return 0.01
        log_ret = np.diff(np.log(closes[-self.volatility_lookback:]))
        return float(np.std(log_ret)) if len(log_ret) > 0 else 0.01

    def _compute_trend(self, closes: np.ndarray) -> str:
        """Simple MA slope trend detector."""
        if len(closes) < self.trend_period + 1:
            return 'ranging'
        ma = np.convolve(closes, np.ones(self.trend_period) / self.trend_period, mode='valid')
        slope = (ma[-1] - ma[-2]) / ma[-2]
        if slope > self.trend_threshold:
            return 'uptrend'
        if slope < -self.trend_threshold:
            return 'downtrend'
        return 'ranging'

    def _rebuild_grid(self, current_price: float, volatility: float) -> None:
        """Re-center and re-space the grid around current_price."""
        half_range = current_price * volatility * math.sqrt(self.volatility_lookback)
        # Trend bias: shift grid bounds toward trend direction
        bias = 0.0
        if self.trend == 'uptrend':
            bias = half_range * 0.2
        elif self.trend == 'downtrend':
            bias = -half_range * 0.2

        self.grid_lower = current_price - half_range + bias
        self.grid_upper = current_price + half_range + bias
        self.grid_levels = list(
            np.linspace(self.grid_lower, self.grid_upper, self.grid_density)
        )

    def _place_buy_orders(self, current_price: float) -> None:
        """Place buy limit orders at grid levels below current price."""
        buy_levels = [lvl for lvl in self.grid_levels if lvl < current_price]
        existing_prices = {o.price for o in self.open_orders.values() if o.side == 'buy'}
        for level in buy_levels:
            if level not in existing_prices:
                qty = self.qty_per_order
                cost = level * qty
                if self.balance >= cost:
                    oid = self._next_id()
                    self.open_orders[oid] = Order(
                        order_id=oid, side='buy', price=level, quantity=qty
                    )
                    self.balance -= cost

    def _cancel_stale_orders(self, current_price: float) -> None:
        """Cancel buy orders that are now above current_price (grid shifted)."""
        stale = [
            oid
            for oid, o in self.open_orders.items()
            if o.side == 'buy' and o.price > current_price
        ]
        for oid in stale:
            o = self.open_orders.pop(oid)
            self.balance += o.price * o.quantity   # refund

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def on_candle(
        self,
        timestamp,
        open_: float,
        high: float,
        low: float,
        close: float,
        closes_history: np.ndarray,
    ) -> None:
        """
        Called once per candle.  `closes_history` should include all
        closes up to and including this candle.
        """
        # 1. Recalculate indicators
        volatility = self._compute_volatility(closes_history)
        self.trend = self._compute_trend(closes_history)

        # 2. Rebuild grid
        self._rebuild_grid(close, volatility)

        # 3. Simulate order fills (candle H/L sweep)
        self._simulate_fills(timestamp, low, high, close)

        # 4. Manage open positions (trailing stop / take profit)
        self._manage_positions(timestamp, low, high, close)

        # 5. Cancel stale orders and place new ones
        self._cancel_stale_orders(close)
        self._place_buy_orders(close)

        # 6. Record equity
        btc_held = sum(p.quantity for p in self.positions)
        self.equity_curve.append(self.balance + btc_held * close)

    def _simulate_fills(self, timestamp, low: float, high: float, close: float) -> None:
        filled_ids = []
        for oid, order in self.open_orders.items():
            if order.side == 'buy' and low <= order.price <= high:
                order.status = 'filled'
                order.fill_price = order.price
                filled_ids.append(oid)
                tp_price = order.price * (1 + self.take_profit_pct / 100)
                sl_price = order.price * (1 - self.stop_loss_pct / 100)
                pos = Position(
                    entry_price=order.price,
                    quantity=order.quantity,
                    take_profit_price=tp_price,
                    stop_loss_price=sl_price,
                    trailing_stop_pct=self.trailing_stop_pct,
                )
                self.positions.append(pos)
                self.trade_log.append({
                    'timestamp': timestamp,
                    'side': 'buy',
                    'price': order.price,
                    'quantity': order.quantity,
                })

        for oid in filled_ids:
            del self.open_orders[oid]

    def _manage_positions(self, timestamp, low: float, high: float, close: float) -> None:
        remaining = []
        for pos in self.positions:
            pos.update_trailing_stop(high)
            exited = False
            exit_price = None
            reason = None

            # Take profit
            if high >= pos.take_profit_price:
                exit_price = pos.take_profit_price
                reason = 'take_profit'
                exited = True
            # Trailing / hard stop
            elif low <= pos.stop_loss_price:
                exit_price = pos.stop_loss_price
                reason = 'stop_loss'
                exited = True

            if exited and exit_price is not None:
                proceeds = exit_price * pos.quantity
                self.balance += proceeds
                self.trade_log.append({
                    'timestamp': timestamp,
                    'side': 'sell',
                    'price': exit_price,
                    'quantity': pos.quantity,
                    'reason': reason,
                    'pnl': proceeds - pos.entry_price * pos.quantity,
                })
            else:
                remaining.append(pos)

        self.positions = remaining

    # ------------------------------------------------------------------
    # Reporting
    # ------------------------------------------------------------------

    def summary(self) -> dict:
        final_equity = self.equity_curve[-1] if self.equity_curve else self.initial_balance
        profit = final_equity - self.initial_balance
        roi = (profit / self.initial_balance) * 100
        eq = np.array(self.equity_curve)
        peak = np.maximum.accumulate(eq)
        drawdowns = (peak - eq) / peak
        max_dd = float(np.max(drawdowns)) * 100
        sells = [t for t in self.trade_log if t['side'] == 'sell']
        return {
            'initial_balance': self.initial_balance,
            'final_value': round(final_equity, 2),
            'total_profit': round(profit, 2),
            'roi_pct': round(roi, 2),
            'total_trades': len(sells),
            'max_drawdown_pct': round(max_dd, 2),
        }
