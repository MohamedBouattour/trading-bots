import { ILogger } from "../../application/ports/ILogger";

/**
 * Console-based logger with timestamps and emoji prefixes.
 */
export class ConsoleLogger implements ILogger {
    private timestamp(): string {
        return new Date().toISOString();
    }

    info(message: string, data?: Record<string, unknown>): void {
        const suffix = data ? ` ${JSON.stringify(data)}` : "";
        console.log(`[${this.timestamp()}] 📊 ${message}${suffix}`);
    }

    warn(message: string, data?: Record<string, unknown>): void {
        const suffix = data ? ` ${JSON.stringify(data)}` : "";
        console.warn(`[${this.timestamp()}] ⚠️  ${message}${suffix}`);
    }

    error(
        message: string,
        error?: Error,
        data?: Record<string, unknown>,
    ): void {
        const errMsg = error ? ` — ${error.message}` : "";
        const suffix = data ? ` ${JSON.stringify(data)}` : "";
        console.error(
            `[${this.timestamp()}] ❌ ${message}${errMsg}${suffix}`,
        );
    }

    trade(message: string, data?: Record<string, unknown>): void {
        const suffix = data ? ` ${JSON.stringify(data)}` : "";
        console.log(`[${this.timestamp()}] 💰 ${message}${suffix}`);
    }
}
