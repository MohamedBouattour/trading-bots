import { RebalanceResult } from "../../domain/models/RebalanceResult";
import { PortfolioSnapshot } from "../../domain/models/PortfolioSnapshot";

export interface BotState {
    /** Schema version for future migrations */
    version: string;
    /** Timestamp of the last portfolio check (Unix ms) */
    lastCheckTimestamp: number;
    /** Timestamp of the last actual trade execution (Unix ms) */
    lastRebalanceTimestamp: number;
    /** Lifetime rebalance cycle counter */
    totalRebalanceCount: number;
    /** Audit log of recent rebalance results (capped at 12) */
    rebalanceHistory: RebalanceResult[];
    /** Most recent portfolio snapshot */
    lastSnapshot: PortfolioSnapshot | null;
    /** Portfolio value at inception, used for ROI calculation */
    initialPortfolioValueUSDT: number;
    /** Cumulative trading fees paid (estimated) */
    cumulativeFeesPaid: number;
}

export interface IStateStore {
    /** Load persisted bot state, or null if no state exists */
    load(): Promise<BotState | null>;
    /** Save current bot state */
    save(state: BotState): Promise<void>;
    /** Check whether a state file already exists */
    exists(): Promise<boolean>;
}

/** Create a blank initial bot state */
export function createInitialBotState(
    initialPortfolioValueUSDT: number,
): BotState {
    return {
        version: "1.0.0",
        lastCheckTimestamp: 0,
        lastRebalanceTimestamp: 0,
        totalRebalanceCount: 0,
        rebalanceHistory: [],
        lastSnapshot: null,
        initialPortfolioValueUSDT,
        cumulativeFeesPaid: 0,
    };
}
