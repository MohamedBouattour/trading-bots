import { describe, it, expect } from "vitest";
import { RebalancingEngine } from "./RebalancingEngine";
import { PortfolioConfig, validatePortfolioConfig } from "../models/PortfolioConfig";
import { PortfolioSnapshot } from "../models/PortfolioSnapshot";
import { AssetAllocation } from "../models/AssetAllocation";

// ── Helpers ──────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<PortfolioConfig> = {}): PortfolioConfig {
    return {
        totalBalanceUSDT: 4000,
        assets: [
            { symbol: "MUUSDT", targetWeight: 0.25 },
            { symbol: "TSMUSDT", targetWeight: 0.20 },
            { symbol: "GOOGLUSDT", targetWeight: 0.20 },
            { symbol: "NVDAUSDT", targetWeight: 0.20 },
            { symbol: "AAPLUSDT", targetWeight: 0.15 },
        ],
        driftThresholdPct: 10,
        profitHarvestCeilingPct: 35,
        rebalanceIntervalSeconds: 2592000,
        leverage: 1,
        useFutures: true,
        dryRun: false,
        feePct: 0.04,
        compoundThresholdUSDT: 10,
        autoScale: false, // disabled by default in tests to isolate behavior
        ...overrides,
    };
}

function makeAllocation(overrides: Partial<AssetAllocation>): AssetAllocation {
    return {
        symbol: "TESTUSDT",
        targetWeight: 0.20,
        currentWeight: 0.20,
        currentValueUSDT: 800,
        targetValueUSDT: 800,
        positionQty: 10,
        currentPrice: 80,
        driftPct: 0,
        ...overrides,
    };
}

function makeSnapshot(
    allocations: AssetAllocation[],
    freeUSDT = 0,
): PortfolioSnapshot {
    const totalValue =
        allocations.reduce((s, a) => s + a.currentValueUSDT, 0) + freeUSDT;
    return {
        timestamp: Date.now(),
        totalValueUSDT: totalValue,
        freeUSDT,
        allocations,
        isBalanced: allocations.every((a) => Math.abs(a.driftPct) <= 10),
    };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("RebalancingEngine", () => {
    const engine = new RebalancingEngine();

    // ── 1. No rebalancing needed ──────────────────────────────────────
    it("should produce no actions when all weights are within threshold", () => {
        const allocations = [
            makeAllocation({ symbol: "MUUSDT", targetWeight: 0.25, currentWeight: 0.27, driftPct: 2, currentValueUSDT: 1080, currentPrice: 100 }),
            makeAllocation({ symbol: "TSMUSDT", targetWeight: 0.20, currentWeight: 0.19, driftPct: -1, currentValueUSDT: 760, currentPrice: 100 }),
            makeAllocation({ symbol: "GOOGLUSDT", targetWeight: 0.20, currentWeight: 0.20, driftPct: 0, currentValueUSDT: 800, currentPrice: 100 }),
            makeAllocation({ symbol: "NVDAUSDT", targetWeight: 0.20, currentWeight: 0.19, driftPct: -1, currentValueUSDT: 760, currentPrice: 100 }),
            makeAllocation({ symbol: "AAPLUSDT", targetWeight: 0.15, currentWeight: 0.15, driftPct: 0, currentValueUSDT: 600, currentPrice: 100 }),
        ];
        const snapshot = makeSnapshot(allocations);
        const config = makeConfig();
        const result = engine.analyzePortfolio(snapshot, config);

        expect(result.actions).toHaveLength(0);
        expect(result.rebalanceTriggered).toBe(false);
        expect(result.profitHarvestTriggered).toBe(false);
    });

    // ── 2. Single asset drifted ───────────────────────────────────────
    it("should rebalance when a single asset drifts beyond threshold", () => {
        // MUUSDT at 34% (target 25%) → drift = +9%, NOT above profit harvest ceiling (35%)
        // But once free USDT + value is considered, let's use a case where total drift > 10
        // We keep MUUSDT at just under 35% but drift still > 10% from target
        const allocations = [
            makeAllocation({ symbol: "MUUSDT", targetWeight: 0.25, currentWeight: 0.36, driftPct: 11, currentValueUSDT: 1440, currentPrice: 100 }),
            makeAllocation({ symbol: "TSMUSDT", targetWeight: 0.20, currentWeight: 0.17, driftPct: -3, currentValueUSDT: 680, currentPrice: 100 }),
            makeAllocation({ symbol: "GOOGLUSDT", targetWeight: 0.20, currentWeight: 0.17, driftPct: -3, currentValueUSDT: 680, currentPrice: 100 }),
            makeAllocation({ symbol: "NVDAUSDT", targetWeight: 0.20, currentWeight: 0.17, driftPct: -3, currentValueUSDT: 680, currentPrice: 100 }),
            makeAllocation({ symbol: "AAPLUSDT", targetWeight: 0.15, currentWeight: 0.13, driftPct: -2, currentValueUSDT: 520, currentPrice: 100 }),
        ];
        const snapshot = makeSnapshot(allocations);
        // Use higher ceiling so profit harvest doesn't fire
        const config = makeConfig({ profitHarvestCeilingPct: 50 });
        const result = engine.analyzePortfolio(snapshot, config);

        expect(result.rebalanceTriggered).toBe(true);
        expect(result.profitHarvestTriggered).toBe(false);
        // Should have a SELL action for MUUSDT
        const muAction = result.actions.find((a) => a.symbol === "MUUSDT");
        expect(muAction).toBeDefined();
        expect(muAction!.side).toBe("SELL");
    });

    // ── 3. Multiple assets drifted ────────────────────────────────────
    it("should rebalance multiple drifted assets", () => {
        // Two over, one under significantly
        const allocations = [
            makeAllocation({ symbol: "MUUSDT", targetWeight: 0.25, currentWeight: 0.38, driftPct: 13, currentValueUSDT: 1520, currentPrice: 100 }),
            makeAllocation({ symbol: "TSMUSDT", targetWeight: 0.20, currentWeight: 0.32, driftPct: 12, currentValueUSDT: 1280, currentPrice: 100 }),
            makeAllocation({ symbol: "GOOGLUSDT", targetWeight: 0.20, currentWeight: 0.06, driftPct: -14, currentValueUSDT: 240, currentPrice: 100 }),
            makeAllocation({ symbol: "NVDAUSDT", targetWeight: 0.20, currentWeight: 0.09, driftPct: -11, currentValueUSDT: 360, currentPrice: 100 }),
            makeAllocation({ symbol: "AAPLUSDT", targetWeight: 0.15, currentWeight: 0.15, driftPct: 0, currentValueUSDT: 600, currentPrice: 100 }),
        ];
        const snapshot = makeSnapshot(allocations);
        const config = makeConfig({ profitHarvestCeilingPct: 50 });
        const result = engine.analyzePortfolio(snapshot, config);

        expect(result.rebalanceTriggered).toBe(true);
        const sells = result.actions.filter((a) => a.side === "SELL");
        const buys = result.actions.filter((a) => a.side === "BUY");
        expect(sells.length).toBeGreaterThanOrEqual(1); // At least MUUSDT and TSMUSDT
        expect(buys.length).toBeGreaterThanOrEqual(1); // At least GOOGLUSDT
    });

    // ── 4. Profit harvest triggered ───────────────────────────────────
    it("should trigger profit harvest when asset exceeds 35% ceiling", () => {
        const allocations = [
            makeAllocation({ symbol: "MUUSDT", targetWeight: 0.25, currentWeight: 0.42, driftPct: 17, currentValueUSDT: 1680, currentPrice: 100 }),
            makeAllocation({ symbol: "TSMUSDT", targetWeight: 0.20, currentWeight: 0.16, driftPct: -4, currentValueUSDT: 640, currentPrice: 100 }),
            makeAllocation({ symbol: "GOOGLUSDT", targetWeight: 0.20, currentWeight: 0.15, driftPct: -5, currentValueUSDT: 600, currentPrice: 100 }),
            makeAllocation({ symbol: "NVDAUSDT", targetWeight: 0.20, currentWeight: 0.15, driftPct: -5, currentValueUSDT: 600, currentPrice: 100 }),
            makeAllocation({ symbol: "AAPLUSDT", targetWeight: 0.15, currentWeight: 0.12, driftPct: -3, currentValueUSDT: 480, currentPrice: 100 }),
        ];
        const snapshot = makeSnapshot(allocations);
        const config = makeConfig();
        const result = engine.analyzePortfolio(snapshot, config);

        expect(result.profitHarvestTriggered).toBe(true);
        const harvestSell = result.actions.find(
            (a) => a.symbol === "MUUSDT" && a.reason === "PROFIT_HARVEST",
        );
        expect(harvestSell).toBeDefined();
        expect(harvestSell!.side).toBe("SELL");
    });

    it("should trigger profit harvest when asset PnL exceeds threshold", () => {
        const allocations = [
            // MUUSDT has 12% PnL, target 10% harvest. Weight is still perfect (25%).
            makeAllocation({ symbol: "MUUSDT", targetWeight: 0.25, currentWeight: 0.25, currentValueUSDT: 1000, unrealizedPnlPct: 12 }),
            makeAllocation({ symbol: "TSMUSDT", targetWeight: 0.20, currentWeight: 0.20, currentValueUSDT: 800, unrealizedPnlPct: 0 }),
            makeAllocation({ symbol: "GOOGLUSDT", targetWeight: 0.20, currentWeight: 0.20, currentValueUSDT: 800, unrealizedPnlPct: 0 }),
            makeAllocation({ symbol: "NVDAUSDT", targetWeight: 0.20, currentWeight: 0.20, currentValueUSDT: 800, unrealizedPnlPct: 0 }),
            makeAllocation({ symbol: "AAPLUSDT", targetWeight: 0.15, currentWeight: 0.15, currentValueUSDT: 600, unrealizedPnlPct: 0 }),
        ];
        const snapshot = makeSnapshot(allocations);
        const config = makeConfig({ assetProfitHarvestPct: 10 });
        const result = engine.analyzePortfolio(snapshot, config);

        expect(result.profitHarvestTriggered).toBe(true);
        const harvestSell = result.actions.find(
            (a) => a.symbol === "MUUSDT" && a.reason === "PROFIT_HARVEST",
        );
        expect(harvestSell).toBeDefined();
        expect(harvestSell!.side).toBe("SELL");
        
        // Should sell roughly the PnL amount: 1000 * (12/112) = 107.14
        expect(harvestSell!.amountUSDT).toBeCloseTo(107.14, 1);
    });

    // ── 5. Profit harvest + redistribution ────────────────────────────
    it("should redistribute harvest proceeds to underweight assets", () => {
        const allocations = [
            makeAllocation({ symbol: "MUUSDT", targetWeight: 0.25, currentWeight: 0.42, driftPct: 17, currentValueUSDT: 1680, currentPrice: 100 }),
            makeAllocation({ symbol: "TSMUSDT", targetWeight: 0.20, currentWeight: 0.16, driftPct: -4, currentValueUSDT: 640, currentPrice: 100 }),
            makeAllocation({ symbol: "GOOGLUSDT", targetWeight: 0.20, currentWeight: 0.15, driftPct: -5, currentValueUSDT: 600, currentPrice: 100 }),
            makeAllocation({ symbol: "NVDAUSDT", targetWeight: 0.20, currentWeight: 0.15, driftPct: -5, currentValueUSDT: 600, currentPrice: 100 }),
            makeAllocation({ symbol: "AAPLUSDT", targetWeight: 0.15, currentWeight: 0.12, driftPct: -3, currentValueUSDT: 480, currentPrice: 100 }),
        ];
        const snapshot = makeSnapshot(allocations);
        const config = makeConfig();
        const result = engine.analyzePortfolio(snapshot, config);

        const redistBuys = result.actions.filter((a) => a.reason === "REDISTRIBUTION");
        expect(redistBuys.length).toBeGreaterThan(0);
        // All redistribution actions should be BUYs
        expect(redistBuys.every((a) => a.side === "BUY")).toBe(true);
    });

    // ── 6. All assets underweight (free USDT available) ───────────────
    it("should handle when all assets are underweight with free USDT", () => {
        const allocations = [
            makeAllocation({ symbol: "MUUSDT", targetWeight: 0.25, currentWeight: 0.10, driftPct: -15, currentValueUSDT: 300, currentPrice: 100 }),
            makeAllocation({ symbol: "TSMUSDT", targetWeight: 0.20, currentWeight: 0.08, driftPct: -12, currentValueUSDT: 240, currentPrice: 100 }),
            makeAllocation({ symbol: "GOOGLUSDT", targetWeight: 0.20, currentWeight: 0.08, driftPct: -12, currentValueUSDT: 240, currentPrice: 100 }),
            makeAllocation({ symbol: "NVDAUSDT", targetWeight: 0.20, currentWeight: 0.08, driftPct: -12, currentValueUSDT: 240, currentPrice: 100 }),
            makeAllocation({ symbol: "AAPLUSDT", targetWeight: 0.15, currentWeight: 0.06, driftPct: -9, currentValueUSDT: 180, currentPrice: 100 }),
        ];
        // Large free USDT balance available
        const snapshot = makeSnapshot(allocations, 2800);
        const config = makeConfig();
        const result = engine.analyzePortfolio(snapshot, config);

        // Should have BUY actions scaled to available funds
        const buys = result.actions.filter((a) => a.side === "BUY");
        expect(buys.length).toBeGreaterThan(0);
    });

    // ── 7. Zero portfolio value ───────────────────────────────────────
    it("should safely handle zero portfolio value", () => {
        const allocations = [
            makeAllocation({ symbol: "MUUSDT", targetWeight: 0.25, currentWeight: 0, driftPct: -25, currentValueUSDT: 0, currentPrice: 0, positionQty: 0 }),
        ];
        const snapshot = makeSnapshot(allocations);
        const config = makeConfig();
        const result = engine.analyzePortfolio(snapshot, config);

        expect(result.actions).toHaveLength(0);
        expect(result.summary).toContain("zero");
    });

    // ── 8. Below minimum notional actions filtered out ────────────────
    it("should filter out actions below minimum notional ($5)", () => {
        // Tiny drift that would result in action < $5
        const allocations = [
            makeAllocation({ symbol: "MUUSDT", targetWeight: 0.25, currentWeight: 0.36, driftPct: 11, currentValueUSDT: 36, currentPrice: 100 }),
            makeAllocation({ symbol: "TSMUSDT", targetWeight: 0.20, currentWeight: 0.16, driftPct: -4, currentValueUSDT: 16, currentPrice: 100 }),
            makeAllocation({ symbol: "GOOGLUSDT", targetWeight: 0.20, currentWeight: 0.16, driftPct: -4, currentValueUSDT: 16, currentPrice: 100 }),
            makeAllocation({ symbol: "NVDAUSDT", targetWeight: 0.20, currentWeight: 0.16, driftPct: -4, currentValueUSDT: 16, currentPrice: 100 }),
            makeAllocation({ symbol: "AAPLUSDT", targetWeight: 0.15, currentWeight: 0.16, driftPct: 1, currentValueUSDT: 16, currentPrice: 100 }),
        ];
        const snapshot = makeSnapshot(allocations);
        const config = makeConfig();
        const result = engine.analyzePortfolio(snapshot, config);

        // The sell on MUUSDT would be ~$11 (36 - 25 = $11), which is > $5 so it should pass
        // The buys may be < $5 depending on total value
        for (const action of result.actions) {
            expect(action.amountUSDT).toBeGreaterThanOrEqual(5);
        }
    });

    // ── 9. Budget balancing — buys scaled down ────────────────────────
    it("should scale down buys when sells + free USDT cannot cover all buys", () => {
        // Under-allocated assets want more than sells provide
        const allocations = [
            makeAllocation({ symbol: "MUUSDT", targetWeight: 0.25, currentWeight: 0.12, driftPct: -13, currentValueUSDT: 480, currentPrice: 100 }),
            makeAllocation({ symbol: "TSMUSDT", targetWeight: 0.20, currentWeight: 0.08, driftPct: -12, currentValueUSDT: 320, currentPrice: 100 }),
            makeAllocation({ symbol: "GOOGLUSDT", targetWeight: 0.20, currentWeight: 0.08, driftPct: -12, currentValueUSDT: 320, currentPrice: 100 }),
            makeAllocation({ symbol: "NVDAUSDT", targetWeight: 0.20, currentWeight: 0.08, driftPct: -12, currentValueUSDT: 320, currentPrice: 100 }),
            makeAllocation({ symbol: "AAPLUSDT", targetWeight: 0.15, currentWeight: 0.64, driftPct: 49, currentValueUSDT: 2560, currentPrice: 100 }),
        ];
        const snapshot = makeSnapshot(allocations, 0);
        const config = makeConfig();
        const result = engine.analyzePortfolio(snapshot, config);

        const sells = result.actions.filter((a) => a.side === "SELL");
        const buys = result.actions.filter((a) => a.side === "BUY");
        const totalSell = sells.reduce((s, a) => s + a.amountUSDT, 0);
        const totalBuy = buys.reduce((s, a) => s + a.amountUSDT, 0);

        // Buys should not exceed sells (no free USDT)
        expect(totalBuy).toBeLessThanOrEqual(totalSell + 1); // +1 for rounding
    });

    // ── detectDrift ───────────────────────────────────────────────────
    describe("detectDrift", () => {
        it("should return only assets beyond threshold", () => {
            const allocations = [
                makeAllocation({ driftPct: 5 }),   // within
                makeAllocation({ driftPct: 12 }),  // beyond
                makeAllocation({ driftPct: -15 }), // beyond
                makeAllocation({ driftPct: 3 }),   // within
            ];

            const drifted = engine.detectDrift(allocations, 10);
            expect(drifted).toHaveLength(2);
        });
    });

    // ── detectProfitHarvest ───────────────────────────────────────────
    describe("detectProfitHarvest", () => {
        it("should return assets exceeding the ceiling weight", () => {
            const allocations = [
                makeAllocation({ currentWeight: 0.30 }), // below 35%
                makeAllocation({ currentWeight: 0.40 }), // above 35%
                makeAllocation({ currentWeight: 0.36 }), // above 35%
            ];

            const harvest = engine.detectProfitHarvest(allocations, 35);
            expect(harvest).toHaveLength(2);
        });

        it("should return empty when no asset exceeds ceiling", () => {
            const allocations = [
                makeAllocation({ currentWeight: 0.25 }),
                makeAllocation({ currentWeight: 0.20 }),
            ];

            const harvest = engine.detectProfitHarvest(allocations, 35);
            expect(harvest).toHaveLength(0);
        });
    });

    // ── Compound Investment ────────────────────────────────────────────
    describe("compound investment", () => {
        it("should deploy free cash to underweight assets when above threshold", () => {
            const allocations = [
                makeAllocation({ symbol: "MUUSDT", targetWeight: 0.25, currentWeight: 0.23, driftPct: -2, currentValueUSDT: 920, currentPrice: 100 }),
                makeAllocation({ symbol: "TSMUSDT", targetWeight: 0.20, currentWeight: 0.18, driftPct: -2, currentValueUSDT: 720, currentPrice: 100 }),
                makeAllocation({ symbol: "GOOGLUSDT", targetWeight: 0.20, currentWeight: 0.19, driftPct: -1, currentValueUSDT: 760, currentPrice: 100 }),
                makeAllocation({ symbol: "NVDAUSDT", targetWeight: 0.20, currentWeight: 0.20, driftPct: 0, currentValueUSDT: 800, currentPrice: 100 }),
                makeAllocation({ symbol: "AAPLUSDT", targetWeight: 0.15, currentWeight: 0.15, driftPct: 0, currentValueUSDT: 600, currentPrice: 100 }),
            ];
            // $200 free USDT with leverage 1 = $200 notional
            const snapshot = makeSnapshot(allocations, 200);
            const config = makeConfig({ compoundThresholdUSDT: 10 });
            const result = engine.analyzePortfolio(snapshot, config);

            expect(result.compoundTriggered).toBe(true);
            const compoundActions = result.actions.filter((a) => a.reason === "COMPOUND_INVEST");
            expect(compoundActions.length).toBeGreaterThan(0);
            expect(compoundActions.every((a) => a.side === "BUY")).toBe(true);
        });

        it("should not compound when free cash is below threshold", () => {
            const allocations = [
                makeAllocation({ symbol: "MUUSDT", targetWeight: 0.25, currentWeight: 0.25, driftPct: 0, currentValueUSDT: 1000, currentPrice: 100 }),
                makeAllocation({ symbol: "TSMUSDT", targetWeight: 0.20, currentWeight: 0.20, driftPct: 0, currentValueUSDT: 800, currentPrice: 100 }),
                makeAllocation({ symbol: "GOOGLUSDT", targetWeight: 0.20, currentWeight: 0.20, driftPct: 0, currentValueUSDT: 800, currentPrice: 100 }),
                makeAllocation({ symbol: "NVDAUSDT", targetWeight: 0.20, currentWeight: 0.20, driftPct: 0, currentValueUSDT: 800, currentPrice: 100 }),
                makeAllocation({ symbol: "AAPLUSDT", targetWeight: 0.15, currentWeight: 0.15, driftPct: 0, currentValueUSDT: 600, currentPrice: 100 }),
            ];
            // Only $5 free (below $10 threshold)
            const snapshot = makeSnapshot(allocations, 5);
            const config = makeConfig({ compoundThresholdUSDT: 10 });
            const result = engine.analyzePortfolio(snapshot, config);

            expect(result.compoundTriggered).toBe(false);
            const compoundActions = result.actions.filter((a) => a.reason === "COMPOUND_INVEST");
            expect(compoundActions).toHaveLength(0);
        });

        it("should respect leverage when calculating compound budget", () => {
            const allocations = [
                makeAllocation({ symbol: "MUUSDT", targetWeight: 0.25, currentWeight: 0.22, driftPct: -3, currentValueUSDT: 880, currentPrice: 100 }),
                makeAllocation({ symbol: "TSMUSDT", targetWeight: 0.20, currentWeight: 0.18, driftPct: -2, currentValueUSDT: 720, currentPrice: 100 }),
                makeAllocation({ symbol: "GOOGLUSDT", targetWeight: 0.20, currentWeight: 0.20, driftPct: 0, currentValueUSDT: 800, currentPrice: 100 }),
                makeAllocation({ symbol: "NVDAUSDT", targetWeight: 0.20, currentWeight: 0.20, driftPct: 0, currentValueUSDT: 800, currentPrice: 100 }),
                makeAllocation({ symbol: "AAPLUSDT", targetWeight: 0.15, currentWeight: 0.15, driftPct: 0, currentValueUSDT: 600, currentPrice: 100 }),
            ];
            // $5 free margin × 3 leverage = $15 notional (above $10 threshold)
            const snapshot = makeSnapshot(allocations, 5);
            const config = makeConfig({ compoundThresholdUSDT: 10, leverage: 3 });
            const result = engine.analyzePortfolio(snapshot, config);

            expect(result.compoundTriggered).toBe(true);
        });
    });

    // ── Auto-Scale ────────────────────────────────────────────────────
    describe("auto-scale", () => {
        it("should apply auto-scale when portfolio value exceeds config", () => {
            const allocations = [
                makeAllocation({ symbol: "MUUSDT", targetWeight: 0.25, currentWeight: 0.25, driftPct: 0, currentValueUSDT: 1250, currentPrice: 100 }),
                makeAllocation({ symbol: "TSMUSDT", targetWeight: 0.20, currentWeight: 0.20, driftPct: 0, currentValueUSDT: 1000, currentPrice: 100 }),
                makeAllocation({ symbol: "GOOGLUSDT", targetWeight: 0.20, currentWeight: 0.20, driftPct: 0, currentValueUSDT: 1000, currentPrice: 100 }),
                makeAllocation({ symbol: "NVDAUSDT", targetWeight: 0.20, currentWeight: 0.20, driftPct: 0, currentValueUSDT: 1000, currentPrice: 100 }),
                makeAllocation({ symbol: "AAPLUSDT", targetWeight: 0.15, currentWeight: 0.15, driftPct: 0, currentValueUSDT: 750, currentPrice: 100 }),
            ];
            const snapshot = makeSnapshot(allocations); // total = 5000
            const config = makeConfig({ totalBalanceUSDT: 4000, autoScale: true });
            const result = engine.analyzePortfolio(snapshot, config);

            expect(result.autoScaleApplied).toBe(true);
        });

        it("should not auto-scale when portfolio value is below config", () => {
            const allocations = [
                makeAllocation({ symbol: "MUUSDT", targetWeight: 0.25, currentWeight: 0.25, driftPct: 0, currentValueUSDT: 750, currentPrice: 100 }),
                makeAllocation({ symbol: "TSMUSDT", targetWeight: 0.20, currentWeight: 0.20, driftPct: 0, currentValueUSDT: 600, currentPrice: 100 }),
                makeAllocation({ symbol: "GOOGLUSDT", targetWeight: 0.20, currentWeight: 0.20, driftPct: 0, currentValueUSDT: 600, currentPrice: 100 }),
                makeAllocation({ symbol: "NVDAUSDT", targetWeight: 0.20, currentWeight: 0.20, driftPct: 0, currentValueUSDT: 600, currentPrice: 100 }),
                makeAllocation({ symbol: "AAPLUSDT", targetWeight: 0.15, currentWeight: 0.15, driftPct: 0, currentValueUSDT: 450, currentPrice: 100 }),
            ];
            const snapshot = makeSnapshot(allocations); // total = 3000
            const config = makeConfig({ totalBalanceUSDT: 4000, autoScale: true });
            const result = engine.analyzePortfolio(snapshot, config);

            expect(result.autoScaleApplied).toBe(false);
        });
    });
});

// ── Config Validation ───────────────────────────────────────────────

describe("validatePortfolioConfig", () => {
    // imported via ES import at top of file

    it("should pass for a valid config", () => {
        const config: PortfolioConfig = {
            totalBalanceUSDT: 4000,
            assets: [
                { symbol: "MUUSDT", targetWeight: 0.25 },
                { symbol: "TSMUSDT", targetWeight: 0.20 },
                { symbol: "GOOGLUSDT", targetWeight: 0.20 },
                { symbol: "NVDAUSDT", targetWeight: 0.20 },
                { symbol: "AAPLUSDT", targetWeight: 0.15 },
            ],
            driftThresholdPct: 10,
            profitHarvestCeilingPct: 35,
            rebalanceIntervalSeconds: 2592000,
            leverage: 1,
            useFutures: true,
            dryRun: false,
            feePct: 0.04,
            compoundThresholdUSDT: 10,
            autoScale: true,
        };
        const errors = validatePortfolioConfig(config);
        expect(errors).toHaveLength(0);
    });

    it("should fail when weights don't sum to 1.0", () => {
        const config: PortfolioConfig = {
            totalBalanceUSDT: 4000,
            assets: [
                { symbol: "A", targetWeight: 0.50 },
                { symbol: "B", targetWeight: 0.30 },
            ],
            driftThresholdPct: 10,
            profitHarvestCeilingPct: 35,
            rebalanceIntervalSeconds: 2592000,
            leverage: 1,
            useFutures: true,
            dryRun: false,
            feePct: 0.04,
            compoundThresholdUSDT: 10,
            autoScale: true,
        };
        const errors = validatePortfolioConfig(config);
        expect(errors.some((e: string) => e.includes("sum to 1.0"))).toBe(true);
    });

    it("should fail when drift threshold is out of range", () => {
        const config: PortfolioConfig = {
            totalBalanceUSDT: 4000,
            assets: [{ symbol: "A", targetWeight: 1.0 }],
            driftThresholdPct: 60,
            profitHarvestCeilingPct: 200,
            rebalanceIntervalSeconds: 2592000,
            leverage: 1,
            useFutures: true,
            dryRun: false,
            feePct: 0.04,
            compoundThresholdUSDT: 10,
            autoScale: true,
        };
        const errors = validatePortfolioConfig(config);
        expect(errors.some((e: string) => e.includes("driftThresholdPct"))).toBe(true);
    });

    it("should fail when rebalance interval is too short", () => {
        const config: PortfolioConfig = {
            totalBalanceUSDT: 4000,
            assets: [{ symbol: "A", targetWeight: 1.0 }],
            driftThresholdPct: 10,
            profitHarvestCeilingPct: 200,
            rebalanceIntervalSeconds: 60,
            leverage: 1,
            useFutures: true,
            dryRun: false,
            feePct: 0.04,
            compoundThresholdUSDT: 10,
            autoScale: true,
        };
        const errors = validatePortfolioConfig(config);
        expect(errors.some((e: string) => e.includes("rebalanceIntervalSeconds"))).toBe(true);
    });
});
