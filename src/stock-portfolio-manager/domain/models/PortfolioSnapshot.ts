import { AssetAllocation } from "./AssetAllocation";

export interface PortfolioSnapshot {
    /** Unix timestamp in milliseconds */
    timestamp: number;
    /** Sum of all position values + free USDT */
    totalValueUSDT: number;
    /** Unallocated cash in USDT */
    freeUSDT: number;
    /** Per-asset breakdown */
    allocations: AssetAllocation[];
    /** true if all assets are within the drift threshold */
    isBalanced: boolean;
}
