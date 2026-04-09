import { RebalanceAction } from "./RebalanceAction";
import { PortfolioSnapshot } from "./PortfolioSnapshot";

export interface RebalanceResult {
    /** Timestamp when the analysis was performed (Unix ms) */
    timestamp: number;
    /** Portfolio snapshot taken before any actions */
    snapshotBefore: PortfolioSnapshot;
    /** List of rebalance actions to execute (or already executed) */
    actions: RebalanceAction[];
    /** Estimated total fees for all actions */
    totalFeesEstimated: number;
    /** Whether drift-based rebalancing was triggered */
    rebalanceTriggered: boolean;
    /** Whether profit-harvest was triggered */
    profitHarvestTriggered: boolean;
    /** Human-readable summary of the cycle */
    summary: string;
}
