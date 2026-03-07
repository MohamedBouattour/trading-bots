import { ILoggerPort } from "../../domain/port/ILoggerPort";

export class ConsoleLogger implements ILoggerPort {
  private timestamp(): string {
    return new Date().toISOString();
  }

  info(message: string): void {
    console.log(`[${this.timestamp()}] INFO  ${message}`);
  }

  warn(message: string): void {
    console.warn(`[${this.timestamp()}] WARN  ${message}`);
  }

  error(message: string, error?: unknown): void {
    console.error(`[${this.timestamp()}] ERROR ${message}`, error ?? "");
  }
}
