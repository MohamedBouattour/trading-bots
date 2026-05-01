# Strategy Benchmark and Bug Report

This report evaluates the strength, weakness, and functional integrity of the **Stock Portfolio Manager (HODL Rebalancer)** following a comprehensive codebase scan.

---

## 📊 Strategy Benchmark: Compound + Auto-Scale

### Strengths
- **Capital Efficiency**: The "Continuous Compounding" mechanism ensures that idle USDT is never sitting wasted. By checking for a $10 notional threshold, it puts small gains back to work immediately.
- **Dynamic Growth**: Unlike static rebalancers, the "Auto-Scale" pillar allows the bot to recognize portfolio growth and adjust its target allocations to match the new "high-water mark."
- **Clean Architecture**: The separation of concerns between domain logic (`RebalancingEngine`) and infrastructure (`BinanceFuturesPortfolioAdapter`) allows for safe testing and easy extension (e.g., adding a new exchange).

### Weaknesses
- **State Sensitivity**: The strategy is highly dependent on the persistence of the `initialPortfolioValueUSDT`. If this state is lost or incorrectly updated, the "ROI Harvest" logic fails.
- **Leverage Risks**: Using 3x leverage on Binance Futures amplifies both gains and losses. The rebalancer does not currently feature an automated deleveraging or emergency liquidation mechanism for extreme market volatility.
- **Fixed Thresholds**: Drift (5%) and Profit Harvest (35%) are fixed. In highly volatile markets, these might trigger too frequently (generating high fees) or too slowly (missing profit-taking opportunities).

---

## 🐞 Functional Bugs & Logic Errors (RESOLVED)

### 1. Major State Persistence Failure ✅
**Location:** `src/stock-portfolio-manager/application/usecases/RunRebalanceCheckUseCase.ts`  
**Status:** FIXED. The use case now correctly updates `updatedState.initialPortfolioValueUSDT` when auto-scaling occurs, ensuring the high-water mark is persisted.

### 2. ROI Harvest Logic Discrepancy ✅
**Location:** `src/stock-portfolio-manager/domain/services/RebalancingEngine.ts` (`calculatePortfolioRoiHarvestActions`)  
**Status:** FIXED. The implementation now sells exactly 20% of the current position value as documented, instead of 100% of the excess gains.

### 3. Compounding Calculation Error ✅
**Location:** `src/stock-portfolio-manager/domain/services/RebalancingEngine.ts` (`calculateCompoundActions`)  
**Status:** FIXED. The `expectedNewWeight` calculation now correctly uses `targetPortfolioValue`.

### 4. Dashboard Negative Asset Visibility ✅
**Location:** `dashboard/src/utils/parser.js` and `App.jsx`  
**Status:** FIXED. The log parser regex was updated to support negative values (notional, weight, qty), and the dashboard UI was enhanced with color-coding for neutral and negative PnL values.

### 5. Shared Indicator Inaccuracy
**Location:** `src/shared/domain/services/IndicatorService.ts` (`computeWilderRSISeries`)  
**Description:** The function produces a series that is one element longer than the input data.  
**Impact:** LOW (for Rebalancer). The rebalancer doesn't currently use RSI.

---

## 🛠 Recommendations
1. **Validation:** Implement a check in `RebalancingEngine` to ensure `totalValue` is consistent across all calculation steps.
2. **Alerting:** Add Telegram or Email notifications for ROI Harvest events.
