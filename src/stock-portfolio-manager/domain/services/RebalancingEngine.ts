import { AssetAllocation } from "../models/AssetAllocation";
import { PortfolioConfig } from "../models/PortfolioConfig";
import { PortfolioSnapshot } from "../models/PortfolioSnapshot";
import { RebalanceAction } from "../models/RebalanceAction";
import { RebalanceResult } from "../models/RebalanceResult";

/** Minimum notional value (USDT) for a Binance order. Actions below this are skipped. */
const MIN_NOTIONAL_USDT = 5;

/**
 * Fraction of each position to sell during a portfolio-level ROI harvest.
 * 20% of each position is sold to lock in gains as free margin.
 */
const ROI_HARVEST_SELL_FRACTION = 0.20;

/**
 * Pure domain service encapsulating all rebalancing decision logic.
 * No I/O — takes data in, returns decisions out.
 *
 * Supports five mechanisms:
 *  1. Auto-Scale:              update totalBalanceUSDT to actual portfolio value
 *  2. Portfolio ROI Harvest:   sell a slice of all positions when total ROI hits threshold
 *  3. Per-Asset Profit Harvest: sell excess from assets > (target + buffer) weight
 *  4. Drift Rebalance:         correct assets that drifted beyond ±driftThresholdPct
 *  5. Compound Investment:     deploy free cash >= threshold into underweight assets
 */
export class RebalancingEngine {
    /**
     * Main entry point: analyze a portfolio snapshot and produce a RebalanceResult
     * describing all necessary actions.
     *
     * @param snapshot          Live portfolio snapshot
     * @param config            Bot configuration
     * @param initialValueUSDT  Portfolio value at inception (for ROI calculation)
     */
    analyzePortfolio(
        snapshot: PortfolioSnapshot,
        config: PortfolioConfig,
        initialValueUSDT?: number,
    ): RebalanceResult {
        const timestamp = Date.now();

        // Edge case: zero portfolio value
        if (snapshot.totalValueUSDT <= 0) {
            return {
                timestamp,
                snapshotBefore: snapshot,
                actions: [],
                totalFeesEstimated: 0,
                rebalanceTriggered: false,
                profitHarvestTriggered: false,
                portfolioRoiHarvestTriggered: false,
                compoundTriggered: false,
                autoScaleApplied: false,
                summary: "Portfolio value is zero. No rebalancing possible.",
            };
        }

        const allActions: RebalanceAction[] = [];
        let profitHarvestTriggered = false;
        let portfolioRoiHarvestTriggered = false;
        let rebalanceTriggered = false;
        let compoundTriggered = false;
        let autoScaleApplied = false;

        // Active positions total: sum of all position notionals ONLY.
        // MUST exclude freeUSDT × leverage — after a harvest free cash swells and
        // would otherwise inflate targets causing drift to buy everything back.
        const activePositionsNotional = snapshot.allocations.reduce(
            (sum, a) => sum + a.currentValueUSDT, 0,
        );

        // ── Step 0: Auto-Scale ──────────────────────────────────────────────
        // Scale only when positions themselves have grown past config baseline.
        // Using activePositionsNotional (not totalValueUSDT) prevents free-cash
        // from triggering auto-scale and inflating drift targets after a harvest.
        const effectiveConfig = { ...config };
        if (config.autoScale !== false && activePositionsNotional > config.totalBalanceUSDT) {
            const maxScale = config.totalBalanceUSDT * 2;
            effectiveConfig.totalBalanceUSDT = Math.min(
                activePositionsNotional,
                maxScale,
            );
            autoScaleApplied = true;
        }

        // ── Step 1: Portfolio-Level ROI Harvest ─────────────────────────────
        // When total ROI >= threshold, trim each asset back to its original
        // baseline size (initialValue × targetWeight). Only sells the excess —
        // won't re-fire after one harvest until prices grow again.
        const roiThreshold = effectiveConfig.portfolioRoiHarvestPct ?? 0;
        if (roiThreshold > 0 && initialValueUSDT && initialValueUSDT > 0) {
            // ROI = growth of active positions only (excludes free cash from prior harvests)
            const currentRoi =
                ((activePositionsNotional - initialValueUSDT) / initialValueUSDT) * 100;

            if (currentRoi >= roiThreshold) {
                const roiHarvestActions = this.calculatePortfolioRoiHarvestActions(
                    snapshot.allocations,
                    currentRoi,
                    roiThreshold,
                    initialValueUSDT,
                );
                if (roiHarvestActions.length > 0) {
                    portfolioRoiHarvestTriggered = true;
                    allActions.push(...roiHarvestActions);
                }
            }
        }

        // ── Step 2: Per-Asset Profit Harvest ────────────────────────────────
        const harvestTargets = this.detectProfitHarvest(
            snapshot.allocations,
            effectiveConfig.profitHarvestCeilingPct,
            effectiveConfig.profitHarvestBufferPct ?? 0,
            effectiveConfig.assetProfitHarvestPct ?? 0,
        );

        if (harvestTargets.length > 0) {
            profitHarvestTriggered = true;
            const harvestActions = this.calculateProfitHarvestActions(
                harvestTargets,
                snapshot.allocations,
                effectiveConfig,
                activePositionsNotional,
            );
            allActions.push(...harvestActions);
        }

        // ── Step 3: Drift Detection ─────────────────────────────────────────
        // Skipped when any harvest fired — positions are intentionally at baseline;
        // free cash is profit to keep, not working capital to redeploy.
        if (!portfolioRoiHarvestTriggered && !profitHarvestTriggered) {
            const handledSymbols = new Set(
                allActions.filter((a) => a.reason === "ROI_HARVEST").map((a) => a.symbol),
            );
            const remainingAllocations = snapshot.allocations.filter(
                (a) => !handledSymbols.has(a.symbol),
            );

            const driftedAssets = this.detectDrift(
                remainingAllocations,
                effectiveConfig.driftThresholdPct,
            );

            if (driftedAssets.length > 0) {
                rebalanceTriggered = true;
                const driftActions = this.calculateRebalanceActions(
                    driftedAssets,
                    effectiveConfig,
                    activePositionsNotional,   // positions only — not inflated by free cash
                );
                allActions.push(...driftActions);
            }
        }

        // ── Step 4: Compound Investment ─────────────────────────────────────
        // Skipped if any harvest ran — don't redeploy freed gains immediately.
        const minFreeMargin = effectiveConfig.minFreeMarginUSDT ?? 0;
        const usableFreeUSDT = Math.max(0, snapshot.freeUSDT - minFreeMargin);
        const compoundThreshold = effectiveConfig.compoundThresholdUSDT ?? 10;
        const notionalFreeCash = usableFreeUSDT * effectiveConfig.leverage;

        if (!portfolioRoiHarvestTriggered && !profitHarvestTriggered &&
            notionalFreeCash >= compoundThreshold) {
            const compoundActions = this.calculateCompoundActions(
                snapshot.allocations,
                effectiveConfig,
                activePositionsNotional,       // positions only — not inflated by free cash
                notionalFreeCash,
            );
            if (compoundActions.length > 0) {
                compoundTriggered = true;
                allActions.push(...compoundActions);
            }
        }

        // ── Step 5: Budget Balancing ────────────────────────────────────────
        const balancedActions = this.balanceBudget(
            allActions,
            snapshot.freeUSDT,
            effectiveConfig,
        );

        // ── Step 6: Filter below minimum notional ────────────────────────────
        const filteredActions = balancedActions.filter(
            (a) => a.amountUSDT >= MIN_NOTIONAL_USDT,
        );

        // ── Step 7: Filter where fee > 5% of trade value ────────────────────
        const feeFilteredActions = filteredActions.filter((a) => {
            const estimatedFee = a.amountUSDT * (effectiveConfig.feePct / 100);
            return estimatedFee <= a.amountUSDT * 0.05;
        });

        // Calculate estimated fees
        const totalFeesEstimated = feeFilteredActions.reduce(
            (sum, a) => sum + a.amountUSDT * (effectiveConfig.feePct / 100),
            0,
        );

        // Build summary
        const summary = this.buildSummary(
            snapshot,
            feeFilteredActions,
            effectiveConfig,
            profitHarvestTriggered,
            portfolioRoiHarvestTriggered,
            rebalanceTriggered,
            compoundTriggered,
            autoScaleApplied,
            initialValueUSDT,
        );

        return {
            timestamp,
            snapshotBefore: snapshot,
            actions: feeFilteredActions,
            totalFeesEstimated,
            rebalanceTriggered,
            profitHarvestTriggered,
            portfolioRoiHarvestTriggered,
            compoundTriggered,
            autoScaleApplied,
            summary,
        };
    }

    // ── Portfolio ROI Harvest ──────────────────────────────────────────────

    /**
     * When total portfolio ROI crosses the threshold, sell a fixed fraction of every position.
     * The fraction scales with how far ROI exceeds the threshold, capped at ROI_HARVEST_SELL_FRACTION.
    /**
     * ROI Harvest: trim each asset back to its ORIGINAL baseline size.
     *
     * Baseline for each asset = initialPortfolioValueUSDT × targetWeight
     * Excess  = currentValueUSDT − baseline  (only positive values are sold)
     *
     * Example: initial $1000, MUUSDT 25% target → baseline $250.
     *   If MUUSDT is now $320 → sell $70 excess, keep $250 active.
     * After harvest every asset sits exactly at its original size,
     * so the trigger will NOT re-fire until prices grow further.
     */
    calculatePortfolioRoiHarvestActions(
        allocations: AssetAllocation[],
        currentRoiPct: number,
        thresholdPct: number,
        initialPortfolioValueUSDT: number,
    ): RebalanceAction[] {
        const actions: RebalanceAction[] = [];

        for (const asset of allocations) {
            // What this position was worth at inception
            const baselineValue = initialPortfolioValueUSDT * asset.targetWeight;
            const excess = asset.currentValueUSDT - baselineValue;

            // Only sell if there is meaningful excess above baseline
            if (excess < MIN_NOTIONAL_USDT) continue;

            const quantityAsset =
                asset.currentPrice > 0 ? excess / asset.currentPrice : 0;

            actions.push({
                symbol: asset.symbol,
                side: "SELL",
                amountUSDT: excess,
                quantityAsset,
                reason: "ROI_HARVEST",
                fromWeight: asset.currentWeight,
                toWeight: asset.targetWeight, // trimmed back to target
            });
        }

        return actions;
    }

    // ── Drift Detection ────────────────────────────────────────────────────

    /**
     * Detect assets whose weight has drifted beyond the threshold.
     * Drift is measured in absolute percentage points.
     */
    detectDrift(
        allocations: AssetAllocation[],
        thresholdPct: number,
    ): AssetAllocation[] {
        return allocations.filter(
            (a) => Math.abs(a.driftPct) > thresholdPct,
        );
    }

    // ── Per-Asset Profit Harvest ──────────────────────────────────────────

    /**
     * Detect assets that exceed the profit harvest ceiling.
     * An asset triggers harvest if its weight exceeds EITHER:
     *  - The absolute ceiling (profitHarvestCeilingPct)
     *  - The relative ceiling (targetWeight + profitHarvestBufferPct)
     */
    detectProfitHarvest(
        allocations: AssetAllocation[],
        ceilingPct: number,
        bufferPct = 0,
        assetProfitHarvestPct = 0,
    ): AssetAllocation[] {
        const ceilingDecimal = ceilingPct / 100;
        return allocations.filter((a) => {
            const absoluteTriggered = a.currentWeight > ceilingDecimal;
            const relativeTriggered =
                bufferPct > 0 &&
                a.currentWeight > a.targetWeight + bufferPct / 100;
            const pnlTriggered =
                assetProfitHarvestPct > 0 &&
                (a.unrealizedPnlPct ?? 0) >= assetProfitHarvestPct;
            
            return absoluteTriggered || relativeTriggered || pnlTriggered;
        });
    }

    // ── Compound Investment ───────────────────────────────────────────────

    /**
     * Calculate compound investment actions — deploy free cash
     * into underweight assets pro-rata by deficit.
     *
     * If all assets are at or above target, distribute equally.
     */
    calculateCompoundActions(
        allocations: AssetAllocation[],
        config: PortfolioConfig,
        totalPortfolioValue: number,
        notionalBudget: number,
    ): RebalanceAction[] {
        const actions: RebalanceAction[] = [];

        // The portfolio's target size after injecting this new cash
        const targetPortfolioValue = totalPortfolioValue + notionalBudget;

        // Find assets that are underweight relative to the NEW portfolio size
        const underweightAssets = allocations.filter(
            (a) => a.currentValueUSDT < targetPortfolioValue * a.targetWeight,
        );

        if (underweightAssets.length === 0) {
            // All assets at or above target even with new cash — distribute equally across all
            const perAsset = notionalBudget / allocations.length;
            for (const asset of allocations) {
                if (perAsset < MIN_NOTIONAL_USDT) continue;
                const quantityAsset =
                    asset.currentPrice > 0 ? perAsset / asset.currentPrice : 0;
                const expectedNewValue = asset.currentValueUSDT + perAsset;
                const expectedNewWeight = expectedNewValue / targetPortfolioValue;

                actions.push({
                    symbol: asset.symbol,
                    side: "BUY",
                    amountUSDT: perAsset,
                    quantityAsset,
                    reason: "COMPOUND_INVEST",
                    fromWeight: asset.currentWeight,
                    toWeight: expectedNewWeight,
                });
            }
            return actions;
        }

        // Calculate total deficit for pro-rata distribution against the NEW size
        const totalDeficit = underweightAssets.reduce((sum, a) => {
            const targetValue = targetPortfolioValue * a.targetWeight;
            return sum + Math.max(0, targetValue - a.currentValueUSDT);
        }, 0);

        if (totalDeficit <= 0) return actions;

        for (const asset of underweightAssets) {
            const targetValue = targetPortfolioValue * asset.targetWeight;
            const deficit = Math.max(0, targetValue - asset.currentValueUSDT);
            if (deficit < MIN_NOTIONAL_USDT) continue;

            // Pro-rata share of compound budget
            const share = (deficit / totalDeficit) * notionalBudget;
            // Don't buy more than the deficit
            const buyAmount = Math.min(share, deficit);

            if (buyAmount < MIN_NOTIONAL_USDT) continue;

            const quantityAsset =
                asset.currentPrice > 0 ? buyAmount / asset.currentPrice : 0;
            const expectedNewValue = asset.currentValueUSDT + buyAmount;
            const expectedNewWeight = expectedNewValue / totalPortfolioValue;

            actions.push({
                symbol: asset.symbol,
                side: "BUY",
                amountUSDT: buyAmount,
                quantityAsset,
                reason: "COMPOUND_INVEST",
                fromWeight: asset.currentWeight,
                toWeight: expectedNewWeight,
            });
        }

        return actions;
    }

    // ── Drift Rebalance ───────────────────────────────────────────────────

    /**
     * Calculate sell/buy actions to bring drifted assets back to their target weights.
     */
    calculateRebalanceActions(
        driftedAssets: AssetAllocation[],
        config: PortfolioConfig,
        totalPortfolioValue: number,
    ): RebalanceAction[] {
        const actions: RebalanceAction[] = [];

        for (const asset of driftedAssets) {
            const targetValue = totalPortfolioValue * asset.targetWeight;
            const delta = targetValue - asset.currentValueUSDT;

            if (Math.abs(delta) < MIN_NOTIONAL_USDT) continue;

            const side: "BUY" | "SELL" = delta > 0 ? "BUY" : "SELL";
            const amountUSDT = Math.abs(delta);
            const quantityAsset =
                asset.currentPrice > 0 ? amountUSDT / asset.currentPrice : 0;

            actions.push({
                symbol: asset.symbol,
                side,
                amountUSDT,
                quantityAsset,
                reason: "DRIFT_REBALANCE",
                fromWeight: asset.currentWeight,
                toWeight: asset.targetWeight,
            });
        }

        return actions;
    }

    // ── Per-Asset Profit Harvest ──────────────────────────────────────────

    /**
     * Calculate profit-harvest sell actions for overweight assets
     * and redistribution buy actions for underweight assets.
     */
    calculateProfitHarvestActions(
        overweightAssets: AssetAllocation[],
        allAllocations: AssetAllocation[],
        config: PortfolioConfig,
        totalPortfolioValue: number,
    ): RebalanceAction[] {
        const actions: RebalanceAction[] = [];
        let harvestProceeds = 0;

        // Sell excess from overweight assets back to their target weight
        for (const asset of overweightAssets) {
            const targetValue = totalPortfolioValue * asset.targetWeight;
            const excessValue = asset.currentValueUSDT - targetValue;

            if (excessValue < MIN_NOTIONAL_USDT) continue;

            const quantityAsset =
                asset.currentPrice > 0 ? excessValue / asset.currentPrice : 0;

            actions.push({
                symbol: asset.symbol,
                side: "SELL",
                amountUSDT: excessValue,
                quantityAsset,
                reason: "PROFIT_HARVEST",
                fromWeight: asset.currentWeight,
                toWeight: asset.targetWeight,
            });

            harvestProceeds += excessValue;
        }

        // Redistribute harvest proceeds to underweight assets (pro-rata)
        if (harvestProceeds > MIN_NOTIONAL_USDT) {
            const overweightSymbols = new Set(overweightAssets.map((a) => a.symbol));
            const underweightAssets = allAllocations.filter(
                (a) =>
                    !overweightSymbols.has(a.symbol) &&
                    a.currentWeight < a.targetWeight,
            );

            if (underweightAssets.length > 0) {
                // Calculate total deficit for pro-rata distribution
                const totalDeficit = underweightAssets.reduce((sum, a) => {
                    const targetValue = totalPortfolioValue * a.targetWeight;
                    return sum + Math.max(0, targetValue - a.currentValueUSDT);
                }, 0);

                for (const asset of underweightAssets) {
                    const targetValue = totalPortfolioValue * asset.targetWeight;
                    const deficit = Math.max(0, targetValue - asset.currentValueUSDT);
                    if (deficit < MIN_NOTIONAL_USDT || totalDeficit <= 0) continue;

                    // Pro-rata share of harvest proceeds
                    const share = (deficit / totalDeficit) * harvestProceeds;
                    // Don't buy more than the deficit
                    const buyAmount = Math.min(share, deficit);

                    if (buyAmount < MIN_NOTIONAL_USDT) continue;

                    const quantityAsset =
                        asset.currentPrice > 0 ? buyAmount / asset.currentPrice : 0;
                    const expectedNewValue = asset.currentValueUSDT + buyAmount;
                    const expectedNewWeight = expectedNewValue / totalPortfolioValue;

                    actions.push({
                        symbol: asset.symbol,
                        side: "BUY",
                        amountUSDT: buyAmount,
                        quantityAsset,
                        reason: "REDISTRIBUTION",
                        fromWeight: asset.currentWeight,
                        toWeight: expectedNewWeight,
                    });
                }
            }
        }

        return actions;
    }

    // ── Budget Balancing ──────────────────────────────────────────────────

    /**
     * Ensure total BUY amounts don't exceed total SELL proceeds + usable free USDT.
     * If they do, scale down BUY actions proportionally.
     */
    private balanceBudget(
        actions: RebalanceAction[],
        freeUSDT: number,
        config: PortfolioConfig,
    ): RebalanceAction[] {
        const totalSells = actions
            .filter((a) => a.side === "SELL")
            .reduce((sum, a) => sum + a.amountUSDT, 0);
        const totalBuys = actions
            .filter((a) => a.side === "BUY")
            .reduce((sum, a) => sum + a.amountUSDT, 0);

        // Respect minFreeMarginUSDT — don't count that portion as available
        const minFreeMargin = config.minFreeMarginUSDT ?? 0;
        const usableFreeUSDT = Math.max(0, freeUSDT - minFreeMargin);

        // Effective available funds for notional buys = total notional sells + (usable margin * leverage)
        const availableFunds = totalSells + (usableFreeUSDT * config.leverage);

        if (totalBuys <= availableFunds || totalBuys === 0) {
            return actions; // Budget is fine
        }

        // Scale down BUY actions proportionally
        const scaleFactor = availableFunds / totalBuys;

        return actions.map((a) => {
            if (a.side === "BUY") {
                const scaledAmount = a.amountUSDT * scaleFactor;
                return {
                    ...a,
                    amountUSDT: scaledAmount,
                    quantityAsset: a.quantityAsset * scaleFactor,
                };
            }
            return a;
        });
    }

    // ── Summary Builder ───────────────────────────────────────────────────

    /**
     * Build a human-readable summary of the rebalance cycle.
     */
    private buildSummary(
        snapshot: PortfolioSnapshot,
        actions: RebalanceAction[],
        config: PortfolioConfig,
        profitHarvestTriggered: boolean,
        portfolioRoiHarvestTriggered: boolean,
        rebalanceTriggered: boolean,
        compoundTriggered: boolean,
        autoScaleApplied: boolean,
        initialValueUSDT?: number,
    ): string {
        const lines: string[] = [];

        // Portfolio value + ROI vs initial
        const roi =
            initialValueUSDT && initialValueUSDT > 0
                ? ((snapshot.totalValueUSDT - initialValueUSDT) / initialValueUSDT) * 100
                : 0;
        const roiStr = initialValueUSDT
            ? ` | Total ROI: ${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%`
            : "";

        lines.push(
            `Portfolio Value: $${snapshot.totalValueUSDT.toFixed(2)}${roiStr} | Free USDT: $${snapshot.freeUSDT.toFixed(2)}`,
        );

        if (autoScaleApplied) {
            lines.push(
                `Auto-scaled totalBalance to $${config.totalBalanceUSDT.toFixed(2)}`,
            );
        }

        if (
            !profitHarvestTriggered &&
            !portfolioRoiHarvestTriggered &&
            !rebalanceTriggered &&
            !compoundTriggered
        ) {
            const maxDrift = Math.max(
                ...snapshot.allocations.map((a) => Math.abs(a.driftPct)),
                0,
            );
            lines.push(
                `No rebalancing needed. Max drift: ${maxDrift.toFixed(1)}% (threshold: ${config.driftThresholdPct}%)`,
            );
        } else {
            if (portfolioRoiHarvestTriggered) {
                const roiActions = actions.filter((a) => a.reason === "ROI_HARVEST");
                const totalRoiSell = roiActions.reduce((s, a) => s + a.amountUSDT, 0);
                lines.push(
                    `💰 Portfolio ROI harvest: sold ${(ROI_HARVEST_SELL_FRACTION * 100).toFixed(0)}% of each position — $${totalRoiSell.toFixed(2)} freed`,
                );
            }
            if (compoundTriggered) {
                const compoundActions = actions.filter(
                    (a) => a.reason === "COMPOUND_INVEST",
                );
                const totalCompound = compoundActions.reduce(
                    (s, a) => s + a.amountUSDT,
                    0,
                );
                lines.push(
                    `📈 Compound invest: ${compoundActions.length} buy(s) totaling $${totalCompound.toFixed(2)}`,
                );
            }
            if (profitHarvestTriggered) {
                const harvestActions = actions.filter(
                    (a) => a.reason === "PROFIT_HARVEST",
                );
                const totalHarvest = harvestActions.reduce(
                    (s, a) => s + a.amountUSDT,
                    0,
                );
                lines.push(
                    `Profit harvest triggered: ${harvestActions.length} sell(s) totaling $${totalHarvest.toFixed(2)}`,
                );
            }
            if (rebalanceTriggered) {
                const driftActions = actions.filter(
                    (a) => a.reason === "DRIFT_REBALANCE",
                );
                lines.push(
                    `Drift rebalance triggered for ${driftActions.length} asset(s)`,
                );
            }

            const sells = actions.filter((a) => a.side === "SELL");
            const buys = actions.filter((a) => a.side === "BUY");
            lines.push(
                `Actions: ${sells.length} sell(s), ${buys.length} buy(s) across ${actions.length} total order(s)`,
            );
        }

        return lines.join(" | ");
    }
}
