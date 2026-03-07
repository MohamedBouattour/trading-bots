import * as dotenv from "dotenv";
import * as path from "path";
import { GridConfig } from "../../domain/model/GridConfig";

// ── Suppress dotenv's promotional console.log/info during config load ────────
function loadEnvSilently(): void {
  const noop = (): void => {};
  const origLog = console.log;
  const origInfo = console.info;
  console.log = noop;
  console.info = noop;
  dotenv.config({ path: path.join(process.cwd(), ".env") });
  console.log = origLog;
  console.info = origInfo;
}

// ── Suppress Node.js built-in deprecation warnings (punycode, url.parse…) ───
const _originalEmitWarning = process.emitWarning;
process.emitWarning = function (
  warning: string | Error,
  ...args: unknown[]
): void {
  if (args[0] === "DeprecationWarning") return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (_originalEmitWarning as any)(warning, ...args);
} as typeof process.emitWarning;

export interface AppConfig {
  readonly apiKey: string;
  readonly apiSecret: string;
  /** Reference capital from .env BALANCE — used for ROI calculation only */
  readonly initialCapital: number;
  readonly grid: GridConfig;
}

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optionalFloat(key: string, fallback: number): number {
  return parseFloat(process.env[key] ?? String(fallback));
}

function optionalInt(key: string, fallback: number): number {
  return parseInt(process.env[key] ?? String(fallback), 10);
}

export function loadConfig(): AppConfig {
  loadEnvSilently();

  const symbol = (process.env.ASSET ?? "BTCUSDT").replace(/['"/]/g, "");

  return {
    apiKey: requireEnv("API_KEY"),
    apiSecret: requireEnv("SECRET_KEY"),
    initialCapital: optionalFloat("BALANCE", 500),
    grid: {
      symbol,
      gridCount: optionalInt("GRID_COUNT", 15),
      swingPct: optionalFloat("SWING_PCT", 15),
      takeProfitPct: optionalFloat("TAKE_PROFIT_PCT", 1),
    },
  };
}
