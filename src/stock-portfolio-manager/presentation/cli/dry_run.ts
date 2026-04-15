/**
 * Dry-run entry point — identical to run_rebalancer.ts but forces DRY RUN mode.
 * No trades will be executed; only analysis and logging.
 *
 * Usage:
 *   npx ts-node src/stock-portfolio-manager/presentation/cli/dry_run.ts
 */

// Force dry-run via environment before any imports
process.env.REBALANCER_DRY_RUN = "true";

// Import and run
import "./run_rebalancer";
