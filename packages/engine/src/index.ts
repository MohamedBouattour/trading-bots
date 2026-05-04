import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import cors from 'cors';
import {
  BinanceAdapter,
  ConsoleLogger,
  FileStateStore,
  ExecuteStrategyUseCase,
  type StrategyBlueprint,
} from '@trading-bots/core';

const STRATEGIES_DIR = process.env.STRATEGIES_DIR ?? './strategies';
const STATES_DIR = process.env.STATES_DIR ?? './states';
const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT ?? 3001);
const LOG_LEVEL = (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error';

const logger = new ConsoleLogger(LOG_LEVEL);
const stateStore = new FileStateStore(STATES_DIR);

const binance = new BinanceAdapter(
  process.env.BINANCE_API_KEY ?? '',
  process.env.BINANCE_SECRET_KEY ?? '',
  process.env.BINANCE_TESTNET === 'true'
);

async function loadBlueprints(): Promise<StrategyBlueprint[]> {
  const files = (await fs.readdir(STRATEGIES_DIR)).filter((f) => f.endsWith('.json'));
  const blueprints: StrategyBlueprint[] = [];
  for (const file of files) {
    const raw = await fs.readFile(path.join(STRATEGIES_DIR, file), 'utf-8');
    try {
      blueprints.push(JSON.parse(raw) as StrategyBlueprint);
    } catch (e) {
      logger.error(`Failed to parse blueprint: ${file}`, { error: String(e) });
    }
  }
  return blueprints;
}

async function runCycle(blueprints: StrategyBlueprint[]): Promise<void> {
  for (const blueprint of blueprints) {
    const useCase = new ExecuteStrategyUseCase(binance, binance, stateStore, logger);
    try {
      await useCase.run(blueprint);
    } catch (err) {
      logger.error('Strategy run failed', { strategyId: blueprint.id, error: String(err) });
    }
  }
}

async function startApiServer(): Promise<void> {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // List all strategy states
  app.get('/api/states', async (_req, res) => {
    try {
      const files = (await fs.readdir(STATES_DIR)).filter((f) => f.endsWith('.state.json'));
      const states = await Promise.all(
        files.map(async (f) => {
          const raw = await fs.readFile(path.join(STATES_DIR, f), 'utf-8');
          return JSON.parse(raw);
        })
      );
      res.json(states);
    } catch {
      res.json([]);
    }
  });

  // Get specific strategy state
  app.get('/api/states/:id', async (req, res) => {
    const state = await stateStore.load(req.params.id);
    if (!state) return res.status(404).json({ error: 'State not found' });
    return res.json(state);
  });

  // List all strategies
  app.get('/api/strategies', async (_req, res) => {
    const blueprints = await loadBlueprints();
    res.json(blueprints);
  });

  // Get specific strategy
  app.get('/api/strategies/:id', async (req, res) => {
    const blueprints = await loadBlueprints();
    const found = blueprints.find((b) => b.id === req.params.id);
    if (!found) return res.status(404).json({ error: 'Blueprint not found' });
    return res.json(found);
  });

  // Create strategy
  app.post('/api/strategies', async (req, res) => {
    const blueprint = req.body as StrategyBlueprint;
    if (!blueprint.id) return res.status(400).json({ error: 'Missing strategy ID' });
    const filePath = path.join(STRATEGIES_DIR, `${blueprint.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(blueprint, null, 2));
    logger.info(`Created strategy blueprint: ${blueprint.id}`);
    res.status(201).json(blueprint);
  });

  // Update strategy
  app.put('/api/strategies/:id', async (req, res) => {
    const blueprint = req.body as StrategyBlueprint;
    const filePath = path.join(STRATEGIES_DIR, `${req.params.id}.json`);
    
    // Check if it exists (might be renamed if ID changed, but we use :id from path)
    try {
      await fs.access(filePath);
    } catch {
      // If filename doesn't match ID, we might need to find the file. 
      // For simplicity, we assume filename is {id}.json
      return res.status(404).json({ error: 'Strategy file not found' });
    }

    await fs.writeFile(filePath, JSON.stringify(blueprint, null, 2));
    logger.info(`Updated strategy blueprint: ${req.params.id}`);
    res.json(blueprint);
  });

  // Delete strategy
  app.delete('/api/strategies/:id', async (req, res) => {
    const filePath = path.join(STRATEGIES_DIR, `${req.params.id}.json`);
    try {
      await fs.unlink(filePath);
      logger.info(`Deleted strategy blueprint: ${req.params.id}`);
      res.status(204).send();
    } catch (e) {
      res.status(404).json({ error: 'Strategy not found' });
    }
  });

  // SSE — live equity stream
  app.get('/api/states/:id/stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = async () => {
      const state = await stateStore.load(req.params.id);
      if (state) res.write(`data: ${JSON.stringify(state)}\n\n`);
    };
    await send();
    const interval = setInterval(send, 10_000);
    req.on('close', () => clearInterval(interval));
  });

  app.listen(DASHBOARD_PORT, () => {
    logger.info(`Engine API listening on port ${DASHBOARD_PORT}`);
  });
}

async function main(): Promise<void> {
  await startApiServer();
  logger.info('Trading bot engine started');

  const blueprints = await loadBlueprints();
  if (blueprints.length === 0) {
    logger.warn('No strategy blueprints found in ' + STRATEGIES_DIR);
  } else {
    logger.info(`Loaded ${blueprints.length} blueprint(s)`, { ids: blueprints.map((b) => b.id) });
  }

  // Initial run
  await runCycle(blueprints);

  // Schedule per-strategy intervals
  for (const blueprint of blueprints) {
    const intervalMs = blueprint.loop.intervalSeconds * 1000;
    setInterval(async () => {
      const freshBlueprints = await loadBlueprints();
      const fresh = freshBlueprints.find((b) => b.id === blueprint.id);
      if (fresh) {
        const useCase = new ExecuteStrategyUseCase(binance, binance, stateStore, logger);
        await useCase.run(fresh).catch((e) =>
          logger.error('Scheduled run failed', { strategyId: fresh.id, error: String(e) })
        );
      }
    }, intervalMs);
    logger.info(`Scheduled ${blueprint.id} every ${blueprint.loop.intervalSeconds}s`);
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
