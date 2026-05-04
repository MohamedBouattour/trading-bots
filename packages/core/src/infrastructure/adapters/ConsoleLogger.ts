import type { ILogger } from '../../application/ports/ILogger.js';

const LEVEL_ORDER = { debug: 0, info: 1, warn: 2, error: 3 } as const;

export class ConsoleLogger implements ILogger {
  constructor(private minLevel: keyof typeof LEVEL_ORDER = 'info') {}

  private log(level: keyof typeof LEVEL_ORDER, message: string, meta?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    if (meta && Object.keys(meta).length) {
      console.log(prefix, message, JSON.stringify(meta));
    } else {
      console.log(prefix, message);
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void { this.log('debug', message, meta); }
  info(message: string, meta?: Record<string, unknown>): void  { this.log('info', message, meta); }
  warn(message: string, meta?: Record<string, unknown>): void  { this.log('warn', message, meta); }
  error(message: string, meta?: Record<string, unknown>): void { this.log('error', message, meta); }
}
