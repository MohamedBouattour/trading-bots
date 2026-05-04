import * as fs from "fs";
import * as path from "path";
import { IStateStore } from "../../application/ports/IStateStore";
import { BotState } from "../../domain/models/BotState";

/**
 * Simple file-based state store.
 * One JSON file per strategy ID in the configured directory.
 * Swap with a Redis/Postgres adapter for production scale-out.
 */
export class FileStateStore implements IStateStore {
  constructor(private readonly dir: string = "./states") {
    fs.mkdirSync(dir, { recursive: true });
  }

  async load(strategyId: string): Promise<BotState | null> {
    const file = path.join(this.dir, `${strategyId}.state.json`);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, "utf-8")) as BotState;
    } catch {
      return null;
    }
  }

  async save(state: BotState): Promise<void> {
    const file = path.join(this.dir, `${state.strategyId}.state.json`);
    fs.writeFileSync(file, JSON.stringify(state, null, 2), "utf-8");
  }
}
