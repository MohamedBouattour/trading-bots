import { Candle } from "../../models/Candle";
import { IBot } from "../domain/bot/IBot";

export interface IReportGenerator {
  generateReport(df: Candle[], bot: IBot, outputPath: string): void;
}
