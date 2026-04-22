import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

// Silence warnings
process.env.NODE_NO_WARNINGS = "1";
process.env.DOTENV_CONFIG_SILENT = "true";

const originalEmitWarning = process.emitWarning;
process.emitWarning = function (warning: Error | string, ...args: unknown[]) {
    if (
        typeof warning === "string" &&
        (warning.includes("punycode") || warning.includes("DeprecationWarning"))
    )
        return;
    if (
        warning instanceof Error &&
        (warning.message.includes("punycode") ||
            warning.name === "DeprecationWarning")
    )
        return;
    return (
        originalEmitWarning as (warning: Error | string, ...args: unknown[]) => void
    )(warning, ...args);
} as (warning: Error | string, ...args: unknown[]) => void;

// ── Load environment ──────────────────────────────────────────────────
dotenv.config({ path: path.join(process.cwd(), ".env") });

import {
    PortfolioConfig,
    validatePortfolioConfig,
} from "../../domain/models/PortfolioConfig";
import { RebalancingEngine } from "../../domain/services/RebalancingEngine";
import { BinanceFuturesPortfolioAdapter } from "../../infrastructure/adapters/BinanceFuturesPortfolioAdapter";
import { FileStateStore } from "../../infrastructure/adapters/FileStateStore";
import { ConsoleLogger } from "../../infrastructure/adapters/ConsoleLogger";
import { RunRebalanceCheckUseCase } from "../../application/usecases/RunRebalanceCheckUseCase";
import { InitializePortfolioUseCase } from "../../application/usecases/InitializePortfolioUseCase";

// ── Parse CLI args ────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isLoopMode = args.includes("--loop");
const isInitMode = args.includes("--init");
const isForceInit = args.includes("--force");
const isDryRun =
    args.includes("--dry-run") ||
    process.env.REBALANCER_DRY_RUN === "true";

// ── Load config ────────────────────────────────────────────────────────
function loadConfig(): PortfolioConfig {
    let resolvedPath = "";

    if (process.env.REBALANCER_CONFIG_PATH) {
        resolvedPath = path.resolve(process.env.REBALANCER_CONFIG_PATH);
    } else {
        // Try current working directory first (typical for built deployments)
        const cwdPath = path.resolve(process.cwd(), "config_longterm.json");
        // Fallback to dev source tree path
        const devPath = path.resolve(
            __dirname,
            "../../infrastructure/config/config_longterm.json",
        );

        if (fs.existsSync(cwdPath)) {
            resolvedPath = cwdPath;
        } else if (fs.existsSync(devPath)) {
            resolvedPath = devPath;
        } else {
            resolvedPath = cwdPath; // Will fail in the next check but gives a good error message
        }
    }

    if (!fs.existsSync(resolvedPath)) {
        console.error(`❌ Config file not found: ${resolvedPath}`);
        process.exit(1);
    }

    const raw = fs.readFileSync(resolvedPath, "utf-8");
    const config = JSON.parse(raw) as PortfolioConfig;

    // Override dry-run from CLI/env
    if (isDryRun) {
        config.dryRun = true;
    }

    return config;
}

// ── Main ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const logger = new ConsoleLogger();

    // ── Validate credentials ──────────────────────────────────────────
    const apiKey = process.env.API_KEY || "";
    const apiSecret = process.env.SECRET_KEY || "";

    if (!apiKey || !apiSecret || apiKey.length < 10) {
        logger.error(
            "Missing or invalid API_KEY / SECRET_KEY in .env file. Cannot connect to Binance.",
        );
        process.exit(1);
    }

    // ── Load & validate config ────────────────────────────────────────
    const config = loadConfig();
    const validationErrors = validatePortfolioConfig(config);

    if (validationErrors.length > 0) {
        logger.error("Config validation failed:");
        for (const err of validationErrors) {
            logger.error(`  → ${err}`);
        }
        process.exit(1);
    }

    const modeLabel = config.dryRun ? "DRY RUN" : "LIVE";
    const compoundLabel = (config.compoundThresholdUSDT ?? 10) >= 999999
        ? "Compound: OFF"
        : `Compound: ≥$${config.compoundThresholdUSDT ?? 10}`;
    const scaleLabel = config.autoScale !== false ? "Auto-Scale: ON" : "Auto-Scale: OFF";
    const roiHarvestLabel = (config.portfolioRoiHarvestPct ?? 0) > 0
        ? `ROI-Harvest: ≥+${config.portfolioRoiHarvestPct}%`
        : "ROI-Harvest: OFF";
    const marginLabel = (config.minFreeMarginUSDT ?? 0) > 0
        ? `Min-Margin: $${config.minFreeMarginUSDT}`
        : "Min-Margin: OFF";

    logger.info(
        "═══════════════════════════════════════════════════════════════",
    );
    logger.info(
        `🚀 HODL REBALANCER | ${modeLabel} | ${config.leverage}× LEV | ${config.assets.length} assets`,
    );
    logger.info(
        `   Interval: ${(config.rebalanceIntervalSeconds / 86400).toFixed(0)}d | ` +
        `Drift: ±${config.driftThresholdPct}% | Harvest: ${config.profitHarvestCeilingPct}% | ` +
        `Buffer: +${config.profitHarvestBufferPct ?? 0}% | ${roiHarvestLabel} | ${marginLabel}`,
    );
    logger.info(
        `   ${compoundLabel} | ${scaleLabel}`,
    );
    logger.info(
        "═══════════════════════════════════════════════════════════════",
    );

    // ── Initialize adapters ───────────────────────────────────────────
    const adapter = new BinanceFuturesPortfolioAdapter(apiKey, apiSecret, logger);
    const statePath =
        process.env.REBALANCER_STATE_PATH ||
        path.join(process.cwd(), "state_rebalancer_longterm.json");
    const stateStore = new FileStateStore(statePath);
    const engine = new RebalancingEngine();

    // ── Set leverage for all symbols ──────────────────────────────────
    if (config.useFutures) {
        for (const asset of config.assets) {
            try {
                await adapter.setLeverage(asset.symbol, config.leverage);
            } catch {
                logger.warn(
                    `Could not set leverage for ${asset.symbol}, continuing...`,
                );
            }
        }
    }

    // ── Initialize mode ───────────────────────────────────────────────
    if (isInitMode) {
        const initUseCase = new InitializePortfolioUseCase(
            adapter,
            adapter,
            stateStore,
            logger,
            config,
        );
        await initUseCase.execute(isForceInit);
        return;
    }

    // ── Rebalance check mode ──────────────────────────────────────────
    const rebalanceUseCase = new RunRebalanceCheckUseCase(
        adapter,
        adapter,
        stateStore,
        logger,
        config,
        engine,
    );

    if (isLoopMode) {
        // Long-running loop mode
        logger.info("Running in LOOP mode. Press Ctrl+C to stop.");

        const runCycle = async () => {
            try {
                await rebalanceUseCase.execute();
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                logger.error("Rebalance cycle failed", error);
            }
        };

        // Run immediately
        await runCycle();

        // Schedule next checks
        const intervalMs = config.rebalanceIntervalSeconds * 1000;
        setInterval(runCycle, intervalMs);

        logger.info(
            `Next check in ${(config.rebalanceIntervalSeconds / 86400).toFixed(0)} days`,
        );
    } else {
        // Single-shot mode
        try {
            await rebalanceUseCase.execute();
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            logger.error("Rebalance cycle failed", error);
            process.exit(1);
        }

        logger.info("✅ Single-shot execution complete.");
        process.exit(0);
    }
}

main().catch((err) => {
    console.error("CRITICAL ERROR:", err);
    process.exit(1);
});
