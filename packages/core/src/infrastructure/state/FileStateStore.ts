import fs from 'fs/promises';
import path from 'path';
import type { IStateStore } from '../../application/ports/IStateStore.js';
import type { BotState } from '../../domain/models/BotState.js';

export class FileStateStore implements IStateStore {
  constructor(private statesDir: string = './states') {}

  private filePath(strategyId: string): string {
    return path.join(this.statesDir, `${strategyId}.state.json`);
  }

  async load(strategyId: string): Promise<BotState | null> {
    try {
      const raw = await fs.readFile(this.filePath(strategyId), 'utf-8');
      return JSON.parse(raw) as BotState;
    } catch {
      return null;
    }
  }

  async save(state: BotState): Promise<void> {
    await fs.mkdir(this.statesDir, { recursive: true });
    await fs.writeFile(this.filePath(state.strategyId), JSON.stringify(state, null, 2), 'utf-8');
  }
}
