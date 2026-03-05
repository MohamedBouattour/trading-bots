import * as fs from "fs";
import { Candle } from "../../../models/Candle";
import { SmartGridBot } from "../../domain/bot/SmartGridBot";
import { IReportGenerator } from "../../ports/IReportGenerator";

export class HtmlReportGenerator implements IReportGenerator {
  generateReport(df: Candle[], bot: SmartGridBot, outputPath: string): void {
    const labels = df.map((c) => new Date(c.timestamp).toLocaleDateString());
    const prices = df.map((c) => c.close);
    const equity = bot.equity_curve.slice(1);

    const html = `<!DOCTYPE html>
<html>
<head>
    <title>Smart Grid Backtest Results</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { background-color: #0d1117; color: white; font-family: sans-serif; }
        .chart-container { width: 90%; margin: auto; padding: 20px; }
    </style>
</head>
<body>
    <h2 style="text-align:center;">BTC/USDT — Smart Grid Backtest</h2>
    <div class="chart-container">
        <canvas id="priceChart"></canvas>
    </div>
    <div class="chart-container">
        <canvas id="equityChart"></canvas>
    </div>
    <script>
        const labels = ${JSON.stringify(labels)};
        const prices = ${JSON.stringify(prices)};
        const equity = ${JSON.stringify(equity)};
        
        new Chart(document.getElementById('priceChart'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'BTC/USDT Close',
                    data: prices,
                    borderColor: '#f0b429',
                    borderWidth: 1,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                scales: {
                    x: { display: false },
                    y: { ticks: { color: 'white' }, grid: { color: '#30363d' } }
                },
                plugins: { legend: { labels: { color: 'white' } } }
            }
        });

        new Chart(document.getElementById('equityChart'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Portfolio Equity',
                    data: equity,
                    borderColor: '#3fb950',
                    borderWidth: 1.2,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                scales: {
                    x: { ticks: { color: 'white', maxTicksLimit: 10 }, grid: { color: '#30363d' } },
                    y: { ticks: { color: 'white' }, grid: { color: '#30363d' } }
                },
                plugins: { legend: { labels: { color: 'white' } } }
            }
        });
    </script>
</body>
</html>`;

    fs.writeFileSync(outputPath, html, "utf8");
    console.log(`  Chart saved → ${outputPath}`);
  }
}
