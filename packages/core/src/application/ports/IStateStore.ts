import { BotState } from "../../domain/models/BotState";

export interface IStateStore {
  load(strategyId: string): Promise<BotState | null>;
  save(state: BotState): Promise<void>;
}
