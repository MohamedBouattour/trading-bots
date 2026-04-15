import * as fs from "fs";
import * as path from "path";
import { ILogger } from "../../application/ports/ILogger";

// ── ANSI color codes ────────────────────────────────────────────────────
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

const FG = {
    black: "\x1b[30m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    gray: "\x1b[90m",
} as const;

const BG = {
    red: "\x1b[41m",
    green: "\x1b[42m",
    yellow: "\x1b[43m",
    blue: "\x1b[44m",
    magenta: "\x1b[45m",
    cyan: "\x1b[46m",
} as const;

// ── Log level definitions ───────────────────────────────────────────────

type LogLevel = "DEBUG" | "INFO" | "SUCCESS" | "TRADE" | "WARN" | "ERROR";

interface LevelConfig {
    label: string;
    emoji: string;
    color: string;
    bgColor?: string;
    consoleMethod: "log" | "warn" | "error";
}

const LEVEL_CONFIG: Record<LogLevel, LevelConfig> = {
    DEBUG: {
        label: "DBG",
        emoji: "🔍",
        color: FG.gray,
        consoleMethod: "log",
    },
    INFO: {
        label: "INF",
        emoji: "📊",
        color: FG.cyan,
        consoleMethod: "log",
    },
    SUCCESS: {
        label: " OK",
        emoji: "✅",
        color: FG.green,
        consoleMethod: "log",
    },
    TRADE: {
        label: "TRD",
        emoji: "💰",
        color: FG.magenta,
        bgColor: BG.magenta,
        consoleMethod: "log",
    },
    WARN: {
        label: "WRN",
        emoji: "⚠️ ",
        color: FG.yellow,
        consoleMethod: "warn",
    },
    ERROR: {
        label: "ERR",
        emoji: "❌",
        color: FG.red,
        bgColor: BG.red,
        consoleMethod: "error",
    },
};

// ── Logger options ──────────────────────────────────────────────────────

export interface ConsoleLoggerOptions {
    /** Enable file-based logging. Default: true if LOG_FILE env is set, otherwise false. */
    enableFileLog?: boolean;
    /** Path to the log file. Default: from LOG_FILE env or "rebalancer.log" in cwd. */
    logFilePath?: string;
    /** Minimum log level to display. Default: "DEBUG". */
    minLevel?: LogLevel;
    /** Show data payloads inline. Default: true. */
    showData?: boolean;
    /** Use colors in console output. Default: true. */
    useColors?: boolean;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
    DEBUG: 0,
    INFO: 1,
    SUCCESS: 2,
    TRADE: 3,
    WARN: 4,
    ERROR: 5,
};

/**
 * Rich console logger with ANSI colors, structured output, and optional file logging.
 *
 * Output format:
 *   [2026-04-15 19:46:08] ✅  OK  │ Portfolio initialized successfully
 *
 * File output (no color codes):
 *   [2026-04-15T19:46:08.123Z] [OK ] Portfolio initialized successfully
 */
export class ConsoleLogger implements ILogger {
    private readonly fileLogEnabled: boolean;
    private readonly logFilePath: string;
    private readonly minLevel: LogLevel;
    private readonly showData: boolean;
    private readonly useColors: boolean;
    private logStream: fs.WriteStream | null = null;

    constructor(options: ConsoleLoggerOptions = {}) {
        this.fileLogEnabled =
            options.enableFileLog ?? !!process.env.LOG_FILE;
        this.logFilePath =
            options.logFilePath ??
            process.env.LOG_FILE ??
            path.join(process.cwd(), "rebalancer.log");
        this.minLevel = options.minLevel ?? "DEBUG";
        this.showData = options.showData ?? true;
        this.useColors = options.useColors ?? true;

        if (this.fileLogEnabled) {
            this.logStream = fs.createWriteStream(this.logFilePath, {
                flags: "a",
                encoding: "utf-8",
            });
        }
    }

    // ── Public API ───────────────────────────────────────────────────────

    debug(message: string, data?: Record<string, unknown>): void {
        this.log("DEBUG", message, undefined, data);
    }

    info(message: string, data?: Record<string, unknown>): void {
        this.log("INFO", message, undefined, data);
    }

    success(message: string, data?: Record<string, unknown>): void {
        this.log("SUCCESS", message, undefined, data);
    }

    warn(message: string, data?: Record<string, unknown>): void {
        this.log("WARN", message, undefined, data);
    }

    error(
        message: string,
        error?: Error,
        data?: Record<string, unknown>,
    ): void {
        this.log("ERROR", message, error, data);
    }

    trade(message: string, data?: Record<string, unknown>): void {
        this.log("TRADE", message, undefined, data);
    }

    // ── Core log method ─────────────────────────────────────────────────

    private log(
        level: LogLevel,
        message: string,
        error?: Error,
        data?: Record<string, unknown>,
    ): void {
        // Level gate
        if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) return;

        const cfg = LEVEL_CONFIG[level];
        const now = new Date();

        // ── Console output (colorized) ──────────────────────────────────
        const ts = this.formatTimestampLocal(now);
        const consoleLine = this.useColors
            ? this.buildColoredLine(ts, cfg, message, error, data)
            : this.buildPlainLine(ts, cfg, message, error, data);

        console[cfg.consoleMethod](consoleLine);

        // ── File output (plain) ─────────────────────────────────────────
        if (this.logStream) {
            const fileLine = this.buildFileLine(now, cfg, message, error, data);
            this.logStream.write(fileLine + "\n");
        }
    }

    // ── Formatters ──────────────────────────────────────────────────────

    /**
     * Local-timezone timestamp: "2026-04-15 19:46:08"
     */
    private formatTimestampLocal(date: Date): string {
        const y = date.getFullYear();
        const mo = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        const h = String(date.getHours()).padStart(2, "0");
        const mi = String(date.getMinutes()).padStart(2, "0");
        const s = String(date.getSeconds()).padStart(2, "0");
        return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
    }

    /**
     * Colorized console line.
     *
     * Example:
     *   [2026-04-15 19:46:08] ✅  OK  │ Portfolio initialized successfully
     */
    private buildColoredLine(
        ts: string,
        cfg: LevelConfig,
        message: string,
        error?: Error,
        data?: Record<string, unknown>,
    ): string {
        const parts: string[] = [];

        // Timestamp — dim gray
        parts.push(`${DIM}${FG.gray}[${ts}]${RESET}`);

        // Level badge — emoji + colored label
        parts.push(`${cfg.emoji} ${BOLD}${cfg.color}${cfg.label}${RESET}`);

        // Separator
        parts.push(`${DIM}${FG.gray}│${RESET}`);

        // Message — default white or level color for WARN/ERROR
        if (cfg.consoleMethod === "error") {
            parts.push(`${BOLD}${FG.red}${message}${RESET}`);
        } else if (cfg.consoleMethod === "warn") {
            parts.push(`${FG.yellow}${message}${RESET}`);
        } else if (cfg.label === " OK") {
            parts.push(`${FG.green}${message}${RESET}`);
        } else if (cfg.label === "TRD") {
            parts.push(`${BOLD}${FG.magenta}${message}${RESET}`);
        } else {
            parts.push(message);
        }

        // Error details
        if (error) {
            parts.push(`${DIM}${FG.red}— ${error.message}${RESET}`);
            if (error.stack) {
                const stackLines = error.stack
                    .split("\n")
                    .slice(1, 4)
                    .map((l) => l.trim());
                for (const line of stackLines) {
                    parts.push(`\n    ${DIM}${FG.gray}${line}${RESET}`);
                }
            }
        }

        // Data payload
        if (data && this.showData && Object.keys(data).length > 0) {
            const dataStr = this.formatData(data);
            parts.push(`${DIM}${FG.gray}${dataStr}${RESET}`);
        }

        return parts.join(" ");
    }

    /**
     * Plain (no-color) console line for terminals without color support.
     */
    private buildPlainLine(
        ts: string,
        cfg: LevelConfig,
        message: string,
        error?: Error,
        data?: Record<string, unknown>,
    ): string {
        const parts = [`[${ts}]`, `${cfg.emoji} ${cfg.label}`, "│", message];

        if (error) {
            parts.push(`— ${error.message}`);
        }

        if (data && this.showData && Object.keys(data).length > 0) {
            parts.push(this.formatData(data));
        }

        return parts.join(" ");
    }

    /**
     * File log line — ISO timestamp, no emojis, no colors.
     *
     * Example:
     *   [2026-04-15T19:46:08.123Z] [OK ] Portfolio initialized successfully
     */
    private buildFileLine(
        date: Date,
        cfg: LevelConfig,
        message: string,
        error?: Error,
        data?: Record<string, unknown>,
    ): string {
        const parts = [
            `[${date.toISOString()}]`,
            `[${cfg.label}]`,
            message,
        ];

        if (error) {
            parts.push(`— ${error.message}`);
        }

        if (data && Object.keys(data).length > 0) {
            parts.push(JSON.stringify(data));
        }

        return parts.join(" ");
    }

    /**
     * Format a data object into a compact key=value string.
     *
     * Example: { price: 100.5, qty: 2 } → "(price=100.5 qty=2)"
     */
    private formatData(data: Record<string, unknown>): string {
        const pairs = Object.entries(data).map(([k, v]) => {
            if (typeof v === "number") {
                return `${k}=${Number.isInteger(v) ? v : v.toFixed(4)}`;
            }
            return `${k}=${v}`;
        });
        return `(${pairs.join(" ")})`;
    }
}
