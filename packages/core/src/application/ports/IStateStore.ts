import type { BotState } from '../../domain/models/BotState.js';

export interface IStateStore {
  load(strategyId: string): Promise<BotState | null>;
  save(state: BotState): Promise<void>;
}
