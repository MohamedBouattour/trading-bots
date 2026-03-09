import { Candle } from "../../models/Candle";
import { MomentumBot } from "../domain/bot/MomentumBot";

export interface IReportGenerator {
  generateReport(df: Candle[], bot: MomentumBot, outputPath: string): void;
}
