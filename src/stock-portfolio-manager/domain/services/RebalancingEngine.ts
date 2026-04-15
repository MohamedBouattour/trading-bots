import { AssetAllocation } from "../models/AssetAllocation";
import { PortfolioConfig } from "../models/PortfolioConfig";
import { PortfolioSnapshot } from "../models/PortfolioSnapshot";
import { RebalanceAction } from "../models/RebalanceAction";
import { RebalanceResult } from "../models/RebalanceResult";

/** Minimum notional value (USDT) for a Binance order. Actions below this are skipped. */
const MIN_NOTIONAL_USDT = 5;

/**
 * Pure domain service encapsulating all rebalancing decision logic.
 * No I/O — takes data in, returns decisions out.
 *
 * Supports three mechanisms:
 *  1. Auto-Scale: update totalBalanceUSDT to actual portfolio value
 *  2. Compound Investment: deploy free cash ≥ threshold into underweight assets
 *  3. Rebalance + Profit Harvest: existing drift/harvest logic
 */
export class RebalancingEngine {
    /**
     * Main entry point: analyze a portfolio snapshot and produce a RebalanceResult
     * describing all necessary actions.
     */
    analyzePortfolio(
        snapshot: PortfolioSnapshot,
        config: PortfolioConfig,
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
                compoundTriggered: false,
                autoScaleApplied: false,
                summary: "Portfolio value is zero. No rebalancing possible.",
            };
        }

        const allActions: RebalanceAction[] = [];
        let profitHarvestTriggered = false;
        let rebalanceTriggered = false;
        let compoundTriggered = false;
        let autoScaleApplied = false;

        // ── Step 0: Auto-Scale ──────────────────────────────────────────────
        // If actual portfolio value exceeds configured totalBalanceUSDT,
        // scale up so all target calculations use the real value.
        const effectiveConfig = { ...config };
        if (config.autoScale !== false && snapshot.totalValueUSDT > config.totalBalanceUSDT) {
            // Cap auto-scale at 2× initial value per cycle to prevent runaway scaling
            const maxScale = config.totalBalanceUSDT * 2;
            effectiveConfig.totalBalanceUSDT = Math.min(
                snapshot.totalValueUSDT,
                maxScale,
            );
            autoScaleApplied = true;
        }

        // ── Step 1: Compound Investment ─────────────────────────────────────
        // Deploy free cash into underweight assets BEFORE checking drift.
        const compoundThreshold = effectiveConfig.compoundThresholdUSDT ?? 10;
        const notionalFreeCash = snapshot.freeUSDT * effectiveConfig.leverage;

        if (notionalFreeCash >= compoundThreshold) {
            const compoundActions = this.calculateCompoundActions(
                snapshot.allocations,
                effectiveConfig,
                snapshot.totalValueUSDT,
                notionalFreeCash,
            );
            if (compoundActions.length > 0) {
                compoundTriggered = true;
                allActions.push(...compoundActions);
            }
        }

        // ── Step 2: Profit Harvest Check ────────────────────────────────────
        const harvestTargets = this.detectProfitHarvest(
            snapshot.allocations,
            effectiveConfig.profitHarvestCeilingPct,
        );

        if (harvestTargets.length > 0) {
            profitHarvestTriggered = true;
            const harvestActions = this.calculateProfitHarvestActions(
                harvestTargets,
                snapshot.allocations,
                effectiveConfig,
                snapshot.totalValueUSDT,
            );
            allActions.push(...harvestActions);
        }

        // ── Step 3: Drift Detection ─────────────────────────────────────────
        // Exclude assets already handled by profit harvest or compound
        const handledSymbols = new Set([
            ...harvestTargets.map((a) => a.symbol),
            ...allActions.filter((a) => a.reason === "COMPOUND_INVEST").map((a) => a.symbol),
        ]);
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
                snapshot.totalValueUSDT,
            );
            allActions.push(...driftActions);
        }

        // ── Step 4: Budget Balancing ────────────────────────────────────────
        const balancedActions = this.balanceBudget(allActions, snapshot.freeUSDT, effectiveConfig);

        // ── Step 5: Filter below minimum notional ────────────────────────────
        const filteredActions = balancedActions.filter(
            (a) => a.amountUSDT >= MIN_NOTIONAL_USDT,
        );

        // ── Step 6: Filter where fee > 5% of trade value ────────────────────
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
            rebalanceTriggered,
            compoundTriggered,
            autoScaleApplied,
        );

        return {
            timestamp,
            snapshotBefore: snapshot,
            actions: feeFilteredActions,
            totalFeesEstimated,
            rebalanceTriggered,
            profitHarvestTriggered,
            compoundTriggered,
            autoScaleApplied,
            summary,
        };
    }

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

    /**
     * Detect assets whose current weight exceeds the profit harvest ceiling.
     */
    detectProfitHarvest(
        allocations: AssetAllocation[],
        ceilingPct: number,
    ): AssetAllocation[] {
        const ceilingDecimal = ceilingPct / 100;
        return allocations.filter((a) => a.currentWeight > ceilingDecimal);
    }

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

        // Find underweight assets (current weight < target weight)
        const underweightAssets = allocations.filter(
            (a) => a.currentWeight < a.targetWeight,
        );

        if (underweightAssets.length === 0) {
            // All assets at or above target — distribute equally across all
            const perAsset = notionalBudget / allocations.length;
            for (const asset of allocations) {
                if (perAsset < MIN_NOTIONAL_USDT) continue;
                const quantityAsset =
                    asset.currentPrice > 0 ? perAsset / asset.currentPrice : 0;
                const expectedNewValue = asset.currentValueUSDT + perAsset;
                const expectedNewWeight = expectedNewValue / (totalPortfolioValue + notionalBudget);

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

        // Calculate total deficit for pro-rata distribution
        const totalDeficit = underweightAssets.reduce((sum, a) => {
            const targetValue = totalPortfolioValue * a.targetWeight;
            return sum + Math.max(0, targetValue - a.currentValueUSDT);
        }, 0);

        if (totalDeficit <= 0) return actions;

        for (const asset of underweightAssets) {
            const targetValue = totalPortfolioValue * asset.targetWeight;
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

    /**
     * Ensure total BUY amounts don't exceed total SELL proceeds + free USDT.
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

        // Effective available funds for notional buys = total notional sells + (free margin * leverage)
        const availableFunds = totalSells + (freeUSDT * config.leverage);

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

    /**
     * Build a human-readable summary of the rebalance cycle.
     */
    private buildSummary(
        snapshot: PortfolioSnapshot,
        actions: RebalanceAction[],
        config: PortfolioConfig,
        profitHarvestTriggered: boolean,
        rebalanceTriggered: boolean,
        compoundTriggered: boolean,
        autoScaleApplied: boolean,
    ): string {
        const lines: string[] = [];

        lines.push(
            `Portfolio Value: $${snapshot.totalValueUSDT.toFixed(2)} | Free USDT: $${snapshot.freeUSDT.toFixed(2)}`,
        );

        if (autoScaleApplied) {
            lines.push(
                `Auto-scaled totalBalance to $${config.totalBalanceUSDT.toFixed(2)}`,
            );
        }

        if (!profitHarvestTriggered && !rebalanceTriggered && !compoundTriggered) {
            const maxDrift = Math.max(
                ...snapshot.allocations.map((a) => Math.abs(a.driftPct)),
                0,
            );
            lines.push(
                `No rebalancing needed. Max drift: ${maxDrift.toFixed(1)}% (threshold: ${config.driftThresholdPct}%)`,
            );
        } else {
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
