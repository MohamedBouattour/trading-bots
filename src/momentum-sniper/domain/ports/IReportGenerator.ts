import { Candle } from "../../../shared/domain/models/Candle";
import { IBot } from "../bot/IBot";

export interface IReportGenerator {
  generateReport(df: Candle[], bot: IBot, outputPath: string): void;
}
