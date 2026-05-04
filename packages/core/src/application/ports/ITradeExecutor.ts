import type { ActionType, ActionParams } from '../../domain/models/StrategyBlueprint.js';
import type { TradeRecord } from '../../domain/models/TradeRecord.js';

export interface ITradeExecutor {
  execute(
    symbol: string,
    action: ActionType,
    params: ActionParams,
    currentPrice: number,
    balance: number
  ): Promise<TradeRecord>;

  closePosition(trade: TradeRecord, currentPrice: number): Promise<TradeRecord>;
}
