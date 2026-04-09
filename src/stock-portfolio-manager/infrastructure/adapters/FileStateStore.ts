import * as fs from "fs";
import * as path from "path";
import { IStateStore, BotState } from "../../application/ports/IStateStore";

/**
 * JSON file-based implementation of IStateStore.
 * Persists bot state to disk with backup-on-write for crash safety.
 */
export class FileStateStore implements IStateStore {
    private readonly filePath: string;
    private readonly backupPath: string;

    constructor(filePath: string) {
        this.filePath = path.resolve(filePath);
        this.backupPath = this.filePath + ".bak";
    }

    async load(): Promise<BotState | null> {
        if (!fs.existsSync(this.filePath)) {
            return null;
        }

        try {
            const raw = fs.readFileSync(this.filePath, "utf-8");
            const parsed = JSON.parse(raw) as BotState;

            // Basic validation
            if (typeof parsed.version !== "string") {
                throw new Error("Missing version field in state file");
            }

            return parsed;
        } catch (error) {
            console.error(
                `[FileStateStore] Failed to load state from ${this.filePath}:`,
                error,
            );

            // Attempt to load from backup
            if (fs.existsSync(this.backupPath)) {
                console.warn(
                    "[FileStateStore] Attempting to load from backup...",
                );
                try {
                    const backupRaw = fs.readFileSync(this.backupPath, "utf-8");
                    return JSON.parse(backupRaw) as BotState;
                } catch {
                    console.error(
                        "[FileStateStore] Backup is also corrupted. Manual review required.",
                    );
                }
            }

            return null;
        }
    }

    async save(state: BotState): Promise<void> {
        // Create backup of current file before overwriting
        if (fs.existsSync(this.filePath)) {
            try {
                fs.copyFileSync(this.filePath, this.backupPath);
            } catch {
                console.warn("[FileStateStore] Failed to create backup.");
            }
        }

        // Ensure directory exists
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const json = JSON.stringify(state, null, 2);
        fs.writeFileSync(this.filePath, json, "utf-8");
    }

    async exists(): Promise<boolean> {
        return fs.existsSync(this.filePath);
    }
}
