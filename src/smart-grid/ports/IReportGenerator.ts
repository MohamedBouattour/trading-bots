import { Candle } from "../../models/Candle";
import { SmartGridBot } from "../domain/bot/SmartGridBot";

export interface IReportGenerator {
  generateReport(df: Candle[], bot: SmartGridBot, outputPath: string): void;
}
