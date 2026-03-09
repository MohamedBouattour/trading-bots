import * as fs from "fs";
import { Candle } from "../../../models/Candle";
import { MomentumBot } from "../../domain/bot/MomentumBot";
import { IReportGenerator } from "../../ports/IReportGenerator";
import { IndicatorService } from "../../../shared/indicators/IndicatorService";

export class HtmlReportGenerator implements IReportGenerator {
  generateReport(df: Candle[], bot: MomentumBot, outputPath: string): void {
    const config = bot.get_config();
    const trendPeriod = config.trend_period ?? 100;
    const rsiPeriod = config.rsi_period ?? 14;

    // 1. Prepare Candle Data
    const candleData = df.map((c) => ({
      time: Math.floor(c.timestamp / 1000), 
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    // 2. Indicators & SL Curve
    const closes = df.map(c => c.close);
    const emaData: any[] = [];
    const rsiData: any[] = [];
    const slCurveData: any[] = [];

    // The sl_curve in bot starts from the first candle processed (after trendPeriod)
    // We need to align it with timestamps
    const offset = df.length - bot.sl_curve.length;

    for (let i = 0; i < df.length; i++) {
      const window = closes.slice(0, i + 1);
      const time = Math.floor(df[i].timestamp / 1000);
      
      if (window.length >= trendPeriod) {
          emaData.push({ time, value: IndicatorService.computeEMA(window, trendPeriod) });
      }
      
      if (window.length >= rsiPeriod + 1) {
          rsiData.push({ time, value: IndicatorService.computeRSI(window, rsiPeriod) });
      }

      const slIdx = i - offset;
      if (slIdx >= 0 && bot.sl_curve[slIdx] !== null) {
          slCurveData.push({ time, value: bot.sl_curve[slIdx] });
      }
    }

    // 3. Prepare Markers with % 
    let lastEntryPrice = 0;
    const markers = bot.trade_log.map((t) => {
      let text = t.reason?.toUpperCase() || t.side.toUpperCase();
      if (t.side === "buy") {
          lastEntryPrice = t.price;
      } else if (t.side === "sell" && lastEntryPrice > 0) {
          const pnlPct = ((t.price - lastEntryPrice) / lastEntryPrice) * 100;
          text += ` (${pnlPct > 0 ? "+" : ""}${pnlPct.toFixed(1)}%)`;
      }

      return {
        time: Math.floor(t.timestamp / 1000),
        position: (t.side === "buy" ? "belowBar" : "aboveBar") as any,
        color: t.side === "buy" ? "#26a69a" : "#ef5350",
        shape: (t.side === "buy" ? "arrowUp" : "arrowDown") as any,
        text: text,
      };
    });

    // 4. Completed Trades Table
    const completedTrades: any[] = [];
    let lastBuy: any = null;
    for (const t of bot.trade_log) {
      if (t.side === "buy") {
        lastBuy = t;
      } else if (t.side === "sell" && lastBuy) {
        const durationMs = t.timestamp - lastBuy.timestamp;
        const hours = Math.floor(durationMs / 3600000);
        const pnlPct = ((t.price - lastBuy.price) / lastBuy.price) * 100;
        completedTrades.push({
          time: new Date(lastBuy.timestamp).toLocaleString(),
          entryPrice: lastBuy.price.toFixed(2),
          exitPrice: t.price.toFixed(2),
          exitReason: t.reason || "N/A",
          hodlTime: `${hours}h`,
          pnl: `${t.pnl?.toFixed(2)} $ (${pnlPct.toFixed(1)}%)`,
          pnlColor: (t.pnl ?? 0) >= 0 ? "#3fb950" : "#ef5350"
        });
        lastBuy = null;
      }
    }

    // 5. Equity Curve
    const MAX_POINTS = 1000;
    const equity = bot.equity_curve;
    const equityStep = Math.max(1, Math.floor(equity.length / MAX_POINTS));
    const downsampledEquity: number[] = [];
    const downsampledEquityLabels: string[] = [];
    for (let i = 0; i < equity.length; i += equityStep) {
      const candleIdx = Math.min(i, df.length - 1);
      downsampledEquityLabels.push(new Date(df[candleIdx].timestamp).toLocaleDateString());
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
        #candleChart { height: 500px; width: 100%; }
        #rsiChart { height: 200px; width: 100%; margin-top: 10px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Optimized Momentum Strategy Results</h1>
        <div class="summary">
            ${Object.entries(bot.summary()).map(([k, v]) => `
                <div class="stat-card">
                    <div class="stat-label">${k.toUpperCase().replace(/_/g, ' ')}</div>
                    <div class="stat-value" style="color: white">${v}</div>
                </div>
            `).join('')}
        </div>

        <div class="chart-container">
            <h2>Price, EMA & Live Stop Loss</h2>
            <div id="candleChart"></div>
            <div id="rsiChart"></div>
        </div>

        <div class="chart-container">
            <h2>Trade History</h2>
            <table>
                <thead>
                    <tr><th>Time</th><th>Entry</th><th>Exit</th><th>Reason</th><th>Hold</th><th>PnL (%)</th></tr>
                </thead>
                <tbody>
                    ${completedTrades.map(t => `
                        <tr>
                            <td>${t.time}</td>
                            <td>${t.entryPrice}</td>
                            <td>${t.exitPrice}</td>
                            <td>${t.exitReason}</td>
                            <td>${t.hodlTime}</td>
                            <td style="color: ${t.pnlColor}">${t.pnl}</td>
                        </tr>
                    `).join('')}
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

            // Main Price Chart
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
                color: '#ef5350', lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Dotted, title: 'Live SL', priceLineVisible: false,
            });
            slSeries.setData(${JSON.stringify(slCurveData)});

            candleSeries.setMarkers(${JSON.stringify(markers)});

            // RSI Sub-Chart
            const rsiChart = LightweightCharts.createChart(document.getElementById('rsiChart'), {
                ...chartOptions,
                rightPriceScale: { ...chartOptions.rightPriceScale, maxValue: 100, minValue: 0 },
            });
            const rsiSeries = rsiChart.addLineSeries({
                color: '#58a6ff', lineWidth: 2, title: 'RSI ${rsiPeriod}', priceLineVisible: false,
            });
            rsiSeries.setData(${JSON.stringify(rsiData)});

            rsiSeries.createPriceLine({ price: 70, color: '#ef5350', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: 'Overbought' });
            rsiSeries.createPriceLine({ price: ${config.rsi_threshold ?? 45}, color: '#3fb950', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: 'Threshold' });
            rsiSeries.createPriceLine({ price: 30, color: '#3fb950', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: 'Oversold' });

            chart.timeScale().subscribeVisibleTimeRangeChange(range => { rsiChart.timeScale().setVisibleRange(range); });
            rsiChart.timeScale().subscribeVisibleTimeRangeChange(range => { chart.timeScale().setVisibleRange(range); });

            chart.timeScale().fitContent();

            // Equity Curve
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
