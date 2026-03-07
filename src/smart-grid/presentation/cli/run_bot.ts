import { loadConfig } from "../../infrastructure/config/EnvConfigLoader";
import { BinanceOrderExecutor } from "../../infrastructure/exchange/BinanceOrderExecutor";
import { BinanceMarketDataAdapter } from "../../infrastructure/exchange/BinanceMarketDataAdapter";
import { ConsoleLogger } from "../../infrastructure/logger/ConsoleLogger";
import { SyncGridOrdersUseCase } from "../../application/usecase/SyncGridOrdersUseCase";

/**
 * Composition root — the ONLY place where concrete implementations are wired.
 * No business logic lives here. Adding a new trigger (cron, REST, CLI flag)
 * means creating a new entry point, not modifying this one.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new ConsoleLogger();

  const useCase = new SyncGridOrdersUseCase(
    new BinanceOrderExecutor(config.apiKey, config.apiSecret),
    new BinanceMarketDataAdapter(),
    logger,
  );

  logger.info(`Starting grid sync for ${config.grid.symbol}...`);
  await useCase.execute({
    config: config.grid,
    initialCapital: config.initialCapital,
  });
  logger.info("Grid sync completed successfully.");
}

main().catch((err: unknown) => {
  console.error("[Fatal]", err);
  process.exit(1);
});
