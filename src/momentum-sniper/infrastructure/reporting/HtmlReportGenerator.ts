import * as fs from "fs";
import { Candle } from "../../../models/Candle";
import { IBot } from "../../domain/bot/IBot";
import { IReportGenerator } from "../../ports/IReportGenerator";
import { IndicatorService } from "../../../shared/indicators/IndicatorService";

export class HtmlReportGenerator implements IReportGenerator {
  generateReport(df: Candle[], bot: IBot, outputPath: string): void {
    const config = bot.get_config();
    const trendPeriod = config.trend_period ?? 100;

    // 1. Prepare Candle Data
    const validTimes = new Set<number>();
    const candleData = df.map((c) => {
      const time = Math.floor(c.timestamp / 1000);
      validTimes.add(time);
      return {
        time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      };
    });

    // 2. Indicators & SL Curve
    const closes = df.map((c) => c.close);
    const emaData: { time: number; value: number }[] = [];
    const slCurveData: { time: number; value: number }[] = [];

    const offset = df.length - bot.sl_curve.length;

    for (let i = 0; i < df.length; i++) {
      const window = closes.slice(0, i + 1);
      const time = Math.floor(df[i].timestamp / 1000);

      if (window.length >= trendPeriod) {
        emaData.push({
          time,
          value: IndicatorService.computeEMA(window, trendPeriod),
        });
      }

      const slIdx = i - offset;
      if (slIdx >= 0 && bot.sl_curve[slIdx] !== null) {
        slCurveData.push({ time, value: bot.sl_curve[slIdx] });
      }
    }

    // 3. Prepare Markers
    let lastEntryTrade: { side: string; price: number } | null = null;
    const markers = bot.trade_log
      .map((t) => {
        const time = Math.floor(t.timestamp / 1000);
        if (!validTimes.has(time)) return null;

        const isEntry = !Object.prototype.hasOwnProperty.call(t, "pnl");

        let text = t.reason?.toUpperCase() || t.side.toUpperCase();

        if (isEntry) {
          lastEntryTrade = t;
        } else if (lastEntryTrade) {
          const sideFactor = lastEntryTrade.side === "buy" ? 1 : -1;
          const pnlPct =
            ((t.price - lastEntryTrade.price) / lastEntryTrade.price) *
            100 *
            sideFactor;
          text += ` (${pnlPct > 0 ? "+" : ""}${pnlPct.toFixed(1)}%)`;
        }

        const isBuy = t.side === "buy";
        return {
          time,
          position: (isBuy ? "belowBar" : "aboveBar") as
            | "belowBar"
            | "aboveBar",
          color: isBuy ? "#26a69a" : "#ef5350",
          shape: (isBuy ? "arrowUp" : "arrowDown") as "arrowUp" | "arrowDown",
          text: text,
        };
      })
      .filter((m) => m !== null);

    // 4. Trade History Table
    const tradeRows: {
      time: string;
      side: string;
      entryPrice: string;
      exitPrice: string;
      exitReason: string;
      hodlTime: string;
      pnl: string;
      pnlColor: string;
    }[] = [];
    let activeEntry: { timestamp: number; side: string; price: number } | null =
      null;

    for (const t of bot.trade_log) {
      const isEntry = !Object.prototype.hasOwnProperty.call(t, "pnl");

      if (isEntry) {
        activeEntry = t;
      } else if (activeEntry) {
        const durationMs = t.timestamp - activeEntry.timestamp;
        const hours = Math.floor(durationMs / 3600000);

        const sideFactor = activeEntry.side === "buy" ? 1 : -1;
        const pnlPct =
          ((t.price - activeEntry.price) / activeEntry.price) *
          100 *
          sideFactor;

        tradeRows.push({
          time: new Date(activeEntry.timestamp).toLocaleString(),
          side: activeEntry.side === "buy" ? "LONG" : "SHORT",
          entryPrice: activeEntry.price.toFixed(2),
          exitPrice: t.price.toFixed(2),
          exitReason: t.reason || "N/A",
          hodlTime: `${hours}h`,
          pnl: `${t.pnl?.toFixed(2)} $ (${pnlPct.toFixed(1)}%)`,
          pnlColor: (t.pnl ?? 0) >= 0 ? "#3fb950" : "#ef5350",
        });
        activeEntry = null;
      }
    }

    // Add open position if exists
    if (activeEntry) {
      tradeRows.push({
        time: new Date(activeEntry.timestamp).toLocaleString(),
        side: activeEntry.side === "buy" ? "LONG" : "SHORT",
        entryPrice: activeEntry.price.toFixed(2),
        exitPrice: "OPEN",
        exitReason: "LIVE",
        hodlTime: "N/A",
        pnl: "N/A",
        pnlColor: "white",
      });
    }

    // 5. Equity Curve
    const MAX_POINTS = 1000;
    const equity = bot.equity_curve;
    const equityStep = Math.max(1, Math.floor(equity.length / MAX_POINTS));
    const downsampledEquity: number[] = [];
    const downsampledEquityLabels: string[] = [];
    for (let i = 0; i < equity.length; i += equityStep) {
      const candleIdx = Math.min(i, df.length - 1);
      downsampledEquityLabels.push(
        new Date(df[candleIdx].timestamp).toLocaleDateString(),
      );
      downsampledEquity.push(equity[i]);
    }

    const html = `<!DOCTYPE html>
<html>
<head>
    <title>Momentum Sniper Analysis</title>
    <script src="https://cdn.jsdelivr.net/npm/lightweight-charts@4.1.1/dist/lightweight-charts.standalone.production.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { background-color: #0d1117; color: white; font-family: sans-serif; margin: 0; padding: 20px; }
        .container { width: 95%; margin: auto; }
        .chart-container { 
            width: 100%; 
            margin: 20px auto; 
            padding: 20px; 
            background: #161b22; 
            border-radius: 8px; 
            border: 1px solid #30363d;
            box-sizing: border-box;
        }
        h1, h2 { text-align: center; color: #58a6ff; }
        .summary { display: flex; justify-content: space-around; flex-wrap: wrap; margin-bottom: 30px; }
        .stat-card { background: #21262d; padding: 15px; border-radius: 6px; border: 1px solid #30363d; margin: 10px; text-align: center; min-width: 120px; }
        .stat-value { font-size: 1.5em; font-weight: bold; color: #3fb950; }
        .stat-label { font-size: 0.8em; color: #8b949e; }
        table { width: 100%; border-collapse: collapse; color: #c9d1d9; margin-top: 20px; }
        th { background: #21262d; color: #58a6ff; text-align: left; padding: 12px; }
        td { padding: 12px; border-bottom: 1px solid #30363d; }
        #candleChart { height: 600px; width: 100%; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Optimized Momentum Strategy Results</h1>
        <div class="summary">
            ${Object.entries(bot.summary())
              .map(
                ([k, v]) => `
                <div class="stat-card">
                    <div class="stat-label">${k.toUpperCase().replace(/_/g, " ")}</div>
                    <div class="stat-value" style="color: white">${v}</div>
                </div>
            `,
              )
              .join("")}
        </div>

        <div class="chart-container">
            <h2>Price, EMA ${trendPeriod} & Stop Loss</h2>
            <div id="candleChart"></div>
        </div>

        <div class="chart-container">
            <h2>Trade History</h2>
            <table>
                <thead>
                    <tr><th>Time</th><th>Side</th><th>Entry</th><th>Exit</th><th>Reason</th><th>Hold</th><th>PnL (%)</th></tr>
                </thead>
                <tbody>
                    ${tradeRows
                      .map(
                        (t) => `
                        <tr>
                            <td>${t.time}</td>
                            <td style="color: ${t.side === "LONG" ? "#58a6ff" : "#ffa657"}">${t.side}</td>
                            <td>${t.entryPrice}</td>
                            <td>${t.exitPrice}</td>
                            <td>${t.exitReason}</td>
                            <td>${t.hodlTime}</td>
                            <td style="color: ${t.pnlColor}">${t.pnl}</td>
                        </tr>
                    `,
                      )
                      .join("")}
                </tbody>
            </table>
        </div>

        <div class="chart-container">
            <h2>Equity Curve</h2>
            <canvas id="equityChart"></canvas>
        </div>
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', () => {
            const chartOptions = {
                layout: { background: { color: '#161b22' }, textColor: '#d1d4dc' },
                grid: { vertLines: { color: '#30363d' }, horzLines: { color: '#30363d' } },
                timeScale: { visible: true, timeVisible: true, borderColor: '#30363d' },
                rightPriceScale: { borderColor: '#30363d' },
                crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
            };

            const chart = LightweightCharts.createChart(document.getElementById('candleChart'), chartOptions);
            const candleSeries = chart.addCandlestickSeries({
                upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
                wickUpColor: '#26a69a', wickDownColor: '#ef5350',
            });
            candleSeries.setData(${JSON.stringify(candleData)});

            const emaSeries = chart.addLineSeries({
                color: '#ff7b72', lineWidth: 2, title: 'EMA ${trendPeriod}', priceLineVisible: false,
            });
            emaSeries.setData(${JSON.stringify(emaData)});

            const slSeries = chart.addLineSeries({
                color: '#ef5350', lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Dotted, title: 'Stop Loss', priceLineVisible: false,
            });
            slSeries.setData(${JSON.stringify(slCurveData)});

            candleSeries.setMarkers(${JSON.stringify(markers)});

            chart.timeScale().fitContent();

            new Chart(document.getElementById('equityChart'), {
                type: 'line',
                data: {
                    labels: ${JSON.stringify(downsampledEquityLabels)},
                    datasets: [{
                        label: 'Equity',
                        data: ${JSON.stringify(downsampledEquity)},
                        borderColor: '#3fb950', fill: true, backgroundColor: 'rgba(63, 185, 80, 0.1)', tension: 0.1
                    }]
                },
                options: {
                    responsive: true,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { grid: { color: '#30363d' }, ticks: { color: '#8b949e' } },
                        x: { grid: { color: '#30363d' }, ticks: { color: '#8b949e' } }
                    }
                }
            });
        });
    </script>
</body>
</html>`;

    fs.writeFileSync(outputPath, html, "utf8");
  }
}
