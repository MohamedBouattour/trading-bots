/**
 * Engine entry point.
 *
 * Automatically discovers all strategy blueprints in /strategies/*.json
 * and runs each one in its own loop. No strategy code lives here —
 * only wiring: blueprint → adapters → ExecuteStrategyUseCase.
 *
 * Usage:
 *   npm run start --workspace=packages/engine          # live trading
 *   DRY_RUN=true npm run start --workspace=packages/engine  # dry run
 */
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

import {
  BinanceAdapter,
  ConsoleLogger,
  FileStateStore,
  ExecuteStrategyUseCase,
  StrategyBlueprint,
} from "@trading-bots/core";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const isDryRun  = process.env.DRY_RUN === "true";
const strategiesDir = path.resolve(process.env.STRATEGIES_DIR ?? path.join(__dirname, "../../../strategies"));
const statesDir     = path.resolve(process.env.STATES_DIR     ?? path.join(__dirname, "../../../states"));

function loadBlueprints(): StrategyBlueprint[] {
  if (!fs.existsSync(strategiesDir)) {
    console.warn(`[Engine] strategies dir not found: ${strategiesDir}`);
    return [];
  }
  return fs
    .readdirSync(strategiesDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const content = fs.readFileSync(path.join(strategiesDir, f), "utf-8");
      return JSON.parse(content) as StrategyBlueprint;
    });
}

async function runBlueprint(blueprint: StrategyBlueprint): Promise<void> {
  const logger = new ConsoleLogger();
  logger.info(`▶ Starting strategy: "${blueprint.name}" [${blueprint.id}]`);

  if (isDryRun) {
    logger.warn(`[DRY RUN] Blueprint loaded, no orders will be placed.`);
    logger.info(JSON.stringify(blueprint, null, 2));
    return;
  }

  const adapter = new BinanceAdapter(
    process.env.BINANCE_API_KEY ?? "",
    process.env.BINANCE_API_SECRET ?? "",
    logger
  );

  await adapter.syncTime();

  const stateStore = new FileStateStore(statesDir);
  const useCase    = new ExecuteStrategyUseCase(adapter, adapter, stateStore, logger);

  const intervalMs = blueprint.loop.intervalSeconds * 1000;

  const tick = async () => {
    try {
      await useCase.run(blueprint);
    } catch (err) {
      logger.error(`[${blueprint.id}] Unhandled error: ${String(err)}`);
    }
  };

  // Run immediately, then on interval
  await tick();
  setInterval(tick, intervalMs);
}

async function main() {
  const blueprints = loadBlueprints();

  if (blueprints.length === 0) {
    console.log([
      "",
      "  No strategy blueprints found.",
      `  Drop a .json file into: ${strategiesDir}`,
      "  See strategies/README.md for the BPML schema.",
      "",
    ].join("\n"));
    return;
  }

  console.log(`\n[Engine] Loaded ${blueprints.length} blueprint(s):`);
  blueprints.forEach((b) => console.log(`  \u2022 ${b.name} (${b.id}) — ${b.symbols.join(", ")}  ⏱ every ${b.loop.intervalSeconds}s`));
  console.log("");

  await Promise.all(blueprints.map(runBlueprint));
}

main().catch(console.error);
