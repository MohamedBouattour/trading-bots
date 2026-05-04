import { ILogger } from "../../application/ports/ILogger";

export class ConsoleLogger implements ILogger {
  debug(msg: string)   { console.log(`\x1b[36m[DEBUG]\x1b[0m ${msg}`); }
  info(msg: string)    { console.log(`\x1b[34m[INFO]\x1b[0m  ${msg}`); }
  success(msg: string) { console.log(`\x1b[32m[OK]\x1b[0m    ${msg}`); }
  warn(msg: string)    { console.log(`\x1b[33m[WARN]\x1b[0m  ${msg}`); }
  error(msg: string)   { console.log(`\x1b[31m[ERR]\x1b[0m   ${msg}`); }
}
