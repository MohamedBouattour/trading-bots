import * as fs from "fs";
import { Candle } from "../../../models/Candle";
import { IBot } from "../../domain/bot/IBot";
import { Trade } from "../../../models/Trade";

interface ITradeRow {
  time: string;
  entryPrice: string;
  exitPrice: string;
  exitReason: string;
  pnl: string;
  pnlColor: string;
}

export class MultiHtmlReportGenerator {
  generateReport(
    df: Candle[],
    bots: { name: string; bot: IBot }[],
    outputPath: string,
  ): void {
    const botSummaries = bots.map(({ name, bot }) => {
      const s = bot.summary();
      return {
        name,
        ...s,
        equity: bot.equity_curve,
      };
    });

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Elite Backtest Comparison</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&family=Outfit:wght@500;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        :root {
            --bg-dark: #0a0c10;
            --card-bg: rgba(22, 27, 34, 0.7);
            --primary: #58a6ff;
            --success: #3fb950;
            --danger: #f85149;
            --warning: #f0883e;
            --text-main: #c9d1d9;
            --text-dim: #8b949e;
            --accent: #d299ff;
            --border: rgba(48, 54, 61, 0.5);
        }

        body { 
            background: linear-gradient(135deg, var(--bg-dark) 0%, #161b22 100%);
            color: var(--text-main); 
            font-family: 'Inter', sans-serif; 
            margin: 0; 
            padding: 40px 20px;
            min-height: 100vh;
        }

        .container { max-width: 1200px; margin: auto; }

        header {
            text-align: center;
            margin-bottom: 50px;
            animation: fadeInDown 0.8s ease-out;
        }

        h1 {
            font-family: 'Outfit', sans-serif;
            font-size: 2.5em;
            background: linear-gradient(to right, var(--primary), var(--accent));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 10px;
        }

        .header-subtitle { color: var(--text-dim); font-size: 1.1em; }

        .dashboard-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }

        .premium-card {
            background: var(--card-bg);
            backdrop-filter: blur(10px);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 24px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            transition: transform 0.3s ease, border-color 0.3s ease;
        }

        .premium-card:hover {
            transform: translateY(-5px);
            border-color: var(--primary);
        }

        .chart-container { width: 100%; margin-top: 20px; }

        .stat-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
            margin-top: 15px;
        }

        .stat-item {
            background: rgba(0,0,0,0.2);
            padding: 12px;
            border-radius: 12px;
        }

        .stat-label { font-size: 0.75em; color: var(--text-dim); text-transform: uppercase; letter-spacing: 1px; }
        .stat-value { font-size: 1.2em; font-weight: 600; margin-top: 4px; }

        h2 { font-family: 'Outfit', sans-serif; font-size: 1.5em; margin-bottom: 20px; color: var(--primary); }

        .comparison-table { width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 30px; }
        .comparison-table th, .comparison-table td { padding: 16px; text-align: left; border-bottom: 1px solid var(--border); }
        .comparison-table th { color: var(--text-dim); font-weight: 600; text-transform: uppercase; font-size: 0.85em; }
        .comparison-table tr:hover { background: rgba(88, 166, 255, 0.05); }

        .badge {
            padding: 4px 10px;
            border-radius: 8px;
            font-size: 0.85em;
            font-weight: 600;
        }
        .badge-success { background: rgba(63, 185, 80, 0.15); color: var(--success); }
        .badge-danger { background: rgba(248, 81, 73, 0.15); color: var(--danger); }

        @keyframes fadeInDown {
            from { opacity: 0; transform: translateY(-20px); }
            to { opacity: 1; transform: translateY(0); }
        }

        canvas { min-height: 400px; width: 100%; }
        .scrollable-table { overflow-x: auto; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1><i class="fas fa-chart-line"></i> Strategic Performance Desk</h1>
            <div class="header-subtitle">Comparative analysis of proprietary trading algorithms</div>
        </header>
        
        <div class="dashboard-grid">
            ${botSummaries
              .map(
                (s) => `
                <div class="premium-card">
                    <div style="display: flex; justify-content: space-between; align-items: start;">
                        <h3 style="margin: 0; font-family: 'Outfit'; font-size: 1.4em;">${s.name}</h3>
                        <span class="badge ${parseFloat(s.roi_pct) >= 0 ? "badge-success" : "badge-danger"}">
                            ${parseFloat(s.roi_pct) >= 0 ? "+" : ""}${s.roi_pct}
                        </span>
                    </div>
                    <div class="stat-grid">
                        <div class="stat-item">
                            <div class="stat-label">Profit</div>
                            <div class="stat-value" style="color: ${parseFloat(s.total_profit) >= 0 ? "var(--success)" : "var(--danger)"}">
                                ${s.total_profit}
                            </div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-label">Win Rate</div>
                            <div class="stat-value">${s.win_rate}</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-label">Trades</div>
                            <div class="stat-value">${s.total_trades}</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-label">Max DD</div>
                            <div class="stat-value" style="color: var(--warning)">${s.max_drawdown_pct}</div>
                        </div>
                    </div>
                </div>
            `,
              )
              .join("")}
        </div>

        <div class="premium-card" style="margin-bottom: 40px;">
            <h2><i class="fas fa-wave-square"></i> Equity Growth Comparison</h2>
            <div class="chart-container">
                <canvas id="multiEquityChart"></canvas>
            </div>
        </div>

        <div class="premium-card">
            <h2><i class="fas fa-list-ul"></i> Executive Summary</h2>
            <div class="scrollable-table">
                <table class="comparison-table">
                    <thead>
                        <tr>
                            <th>Strategy</th>
                            <th>ROI %</th>
                            <th>Max Drawdown</th>
                            <th>Win Rate</th>
                            <th>Total Trades</th>
                            <th>Final Equity</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${botSummaries
                          .map(
                            (s) => `
                            <tr>
                                <td><strong>${s.name}</strong></td>
                                <td style="color: ${parseFloat(s.roi_pct) >= 0 ? "var(--success)" : "var(--danger)"}">${s.roi_pct}</td>
                                <td>${s.max_drawdown_pct}</td>
                                <td>${s.win_rate}</td>
                                <td>${s.total_trades}</td>
                                <td>${s.final_value}</td>
                            </tr>
                        `,
                          )
                          .join("")}
                    </tbody>
                </table>
            </div>
        </div>

        ${bots
          .map(
            ({ name, bot }) => `
            <div class="premium-card" style="margin-top: 30px;">
                <h2><i class="fas fa-history"></i> Recent Execution: ${name}</h2>
                <div class="scrollable-table">
                    <table class="comparison-table">
                        <thead>
                            <tr><th>Exit Time</th><th>Entry</th><th>Exit</th><th>Reason</th><th>PnL (%)</th></tr>
                        </thead>
                        <tbody>
                            ${this._getTradeRows(bot)
                              .slice(-10)
                              .reverse()
                              .map(
                                (t) => `
                                <tr>
                                    <td>${t.time}</td>
                                    <td>${t.entryPrice}</td>
                                    <td>${t.exitPrice}</td>
                                    <td><span class="badge" style="background: rgba(255,255,255,0.05); color: var(--text-dim);">${t.exitReason}</span></td>
                                    <td style="color: ${t.pnlColor}">${t.pnl}</td>
                                </tr>
                            `,
                              )
                              .join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        `,
          )
          .join("")}
    </div>

    <script>
        const colors = ['#3fb950', '#58a6ff', '#f0883e', '#d299ff', '#ff7b72'];
        
        const datasets = ${JSON.stringify(
          botSummaries.map((s, i) => ({
            label: s.name,
            data: s.equity,
            borderColor: ["#3fb950", "#58a6ff", "#f0883e", "#d299ff"][i % 4],
            borderWidth: 2.5,
            backgroundColor: "transparent",
            tension: 0.3,
            pointRadius: 0,
            pointHitRadius: 10,
          })),
        )};

        const maxLen = Math.max(...datasets.map(d => d.data.length));
        const labels = Array.from({length: maxLen}, (_, i) => '');

        new Chart(document.getElementById('multiEquityChart').getContext('2d'), {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: '#8b949e', font: { family: 'Inter', size: 12 }, usePointStyle: true, padding: 20 }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(13, 17, 23, 0.9)',
                        titleColor: '#58a6ff',
                        padding: 12,
                        cornerRadius: 8,
                        displayColors: true
                    }
                },
                scales: {
                    y: { 
                        grid: { color: 'rgba(48, 54, 61, 0.3)' }, 
                        ticks: { color: '#8b949e', font: { family: 'Inter' } } 
                    },
                    x: { display: false }
                }
            }
        });
    </script>
</body>
</html>`;

    fs.writeFileSync(outputPath, html, "utf8");
  }

  private _getTradeRows(bot: IBot): ITradeRow[] {
    const tradeRows: ITradeRow[] = [];
    let activeBuy: Trade | null = null;

    for (const t of bot.trade_log) {
      if (t.side === "buy") {
        activeBuy = t;
      } else if (t.side === "sell" && activeBuy) {
        const pnlPct = ((t.price - activeBuy.price) / activeBuy.price) * 100;
        tradeRows.push({
          time: new Date(activeBuy.timestamp).toLocaleString(),
          entryPrice: activeBuy.price.toFixed(2),
          exitPrice: t.price.toFixed(2),
          exitReason: t.reason || "N/A",
          pnl: `${t.pnl?.toFixed(2)} $ (${pnlPct.toFixed(1)}%)`,
          pnlColor: (t.pnl ?? 0) >= 0 ? "#3fb950" : "#ef5350",
        });
        activeBuy = null;
      }
    }
    return tradeRows;
  }
}
