import { AssetBalance } from "./Balance";

export interface MarketState {
  readonly symbol: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly currentPrice: number;
  readonly baseBalance: AssetBalance;
  readonly quoteBalance: AssetBalance;
}
