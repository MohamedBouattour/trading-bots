/** Owned by the domain — keeps use cases decoupled from console/file/cloud logging. */
export interface ILoggerPort {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}
