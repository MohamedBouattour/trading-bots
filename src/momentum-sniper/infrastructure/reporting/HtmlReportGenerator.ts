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

    const rsiPeriod = config.rsi_period ?? 7;
    const rsiSmaPeriod = config.rsi_sma_period ?? 7;
    const allRsi = IndicatorService.computeWilderRSISeries(closes, rsiPeriod);
    const rsiData: { time: number; value: number }[] = [];
    const rsiSmaData: { time: number; value: number }[] = [];
    const rsiRawValues: number[] = [];

    const offset = df.length - bot.sl_curve.length;
    const historyLimit = Math.max(trendPeriod * 2 + 50, 300);

    for (let i = 0; i < df.length; i++) {
      // Create a visual window that mimics the bot's internal memory cap for accurate EMA lines
      const windowStart = Math.max(0, i + 1 - historyLimit);
      const window = closes.slice(windowStart, i + 1);
      const time = Math.floor(df[i].timestamp / 1000);

      if (window.length >= trendPeriod) {
        emaData.push({
          time,
          value: IndicatorService.computeEMA(window, trendPeriod),
        });
      }

      rsiRawValues.push(allRsi[i]);
      rsiData.push({ time, value: allRsi[i] });
      if (i >= rsiSmaPeriod) {
        const smaWind = rsiRawValues.slice(i - rsiSmaPeriod + 1, i + 1);
        const smaVal = smaWind.reduce((a, b) => a + b, 0) / rsiSmaPeriod;
        rsiSmaData.push({ time, value: smaVal });
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

    // ── Build inline summary table from bot.summary() ──────────────────────
    const summaryEntries = Object.entries(bot.summary());
    const summaryTableRows = summaryEntries
      .map(
        ([k, v]) => `| **${k.replace(/_/g, " ").toUpperCase()}** | \`${v}\` |`,
      )
      .join("\n");

    // config stores pct values already as numbers like 1.5 (= 1.5%), 6.0 (= 6%)
    const slPct = (config.stop_loss_pct ?? 1.5).toFixed(1);
    const tpPct = (config.take_profit_pct ?? 6.0).toFixed(1);
    const rr = (
      (config.take_profit_pct ?? 6.0) / (config.stop_loss_pct ?? 1.5)
    ).toFixed(1);

    const readmeMd = `
# Momentum Sniper — ${config.symbol || "Asset"} Backtest Report

> Auto-generated report — strategy: **RSI + EMA-${trendPeriod} Trend Filter** · pair: **${config.symbol || "Asset"}** · timeframe: **Backtest**

---

## 📊 Backtest Results

| Metric | Value |
|--------|-------|
${summaryTableRows}

---

## 🤖 How the Strategy Works

The bot scans 4-hour candles and enters a trade only when **both** a momentum signal and a trend filter agree.

### ▲ LONG Entry
1. Close price is **above** EMA-${trendPeriod} → uptrend confirmed.
2. RSI(14) **crosses above 50** on this candle (was ≤ 50 on the previous candle).
3. Entry at the **next candle open**.

### ▼ SHORT Entry
1. Close price is **below** EMA-${trendPeriod} → downtrend confirmed.
2. RSI(14) **crosses below 50** on this candle (was ≥ 50 on the previous candle).
3. Entry at the **next candle open**.

---

## 🛡 Risk Management

| Parameter | Value |
|-----------|-------|
| Stop Loss | **${slPct}%** per trade |
| Take Profit | **${tpPct}%** per trade |
| Risk / Reward | **1 : ${rr}** |
| Position Sizing | Fixed % account risk per trade |
| Max Open Positions | **1** (one trade at a time) |

> At a **1:${rr} R/R ratio**, the strategy is profitable above a ~${Math.ceil(100 / (parseFloat(rr) + 1))}% win rate.

---

## 📈 Chart Guide

| Marker | Meaning |
|--------|---------|
| ▲ Green arrow (below bar) | LONG entry or LONG exit |
| ▼ Red arrow (above bar) | SHORT entry or SHORT exit |
| Orange line | EMA-${trendPeriod} (trend filter) |
| Red dotted line | Active Stop Loss level |
`;

    // ── Stat card colour helper ───────────────────────────────────────────
    const statColor = (key: string, _val: string): string => {
      const k = key.toLowerCase();
      if (k.includes("profit") || k.includes("roi") || k.includes("final"))
        return "#3fb950";
      if (k.includes("drawdown")) return "#ef5350";
      if (k.includes("win_rate")) return "#e3b341";
      if (k.includes("total_trades")) return "#58a6ff";
      return "#c9d1d9";
    };

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Momentum Sniper — Backtest Results</title>
    <meta name="description" content="Momentum Sniper trading bot backtest analysis and performance report.">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/lightweight-charts@4.1.1/dist/lightweight-charts.standalone.production.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <style>
        /* ── Design tokens ── */
        :root {
            --bg:      #0d1117;
            --surface: #161b22;
            --surf2:   #21262d;
            --border:  #30363d;
            --text:    #c9d1d9;
            --muted:   #8b949e;
            --accent:  #58a6ff;
            --green:   #3fb950;
            --red:     #ef5350;
            --orange:  #e3b341;
            --mono:    "JetBrains Mono", monospace;
        }
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background: var(--bg);
            color: var(--text);
            font-family: "Inter", sans-serif;
            font-size: 14px;
            line-height: 1.6;
            padding: 24px;
        }
        .container { width: 95%; max-width: 1400px; margin: auto; }

        /* ── Page header ── */
        .page-header { text-align: center; margin-bottom: 32px; }
        .page-header h1 {
            font-size: 2rem; font-weight: 700; color: var(--accent); letter-spacing: -.5px;
        }
        .page-header .subtitle { color: var(--muted); margin-top: 6px; font-size: .95rem; }

        /* ── README panel ── */
        .readme-panel {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 10px;
            margin-bottom: 32px;
            overflow: hidden;
        }
        .readme-header {
            display: flex; align-items: center; gap: 10px;
            padding: 12px 20px;
            background: var(--surf2);
            border-bottom: 1px solid var(--border);
            font-size: .82rem; color: var(--muted); font-weight: 500;
        }
        .readme-header .rh-title { color: var(--text); font-weight: 600; }
        .readme-body { padding: 28px 32px; }
        .readme-body h1 {
            font-size: 1.5rem; color: var(--text); font-weight: 700;
            border-bottom: 1px solid var(--border);
            padding-bottom: 10px; margin-bottom: 12px;
        }
        .readme-body h2 { font-size: 1.05rem; color: var(--accent); margin: 22px 0 8px; font-weight: 600; }
        .readme-body h3 { font-size: .95rem; color: var(--green); margin: 16px 0 6px; font-weight: 600; }
        .readme-body p  { margin-bottom: 10px; color: var(--muted); }
        .readme-body strong { color: var(--text); }
        .readme-body ul, .readme-body ol { padding-left: 20px; margin-bottom: 12px; color: var(--muted); }
        .readme-body li { margin-bottom: 3px; }
        .readme-body li strong { color: var(--accent); }
        .readme-body code {
            font-family: var(--mono); font-size: .8rem;
            background: var(--surf2); border: 1px solid var(--border);
            padding: 2px 6px; border-radius: 4px; color: var(--orange);
        }
        .readme-body pre {
            background: var(--surf2); border: 1px solid var(--border);
            border-radius: 8px; padding: 14px; overflow-x: auto; margin-bottom: 12px;
        }
        .readme-body pre code {
            background: none; border: none; padding: 0;
            color: var(--green); font-size: .8rem; line-height: 1.7;
        }
        .readme-body hr { border: none; border-top: 1px solid var(--border); margin: 18px 0; }

        /* ── Stat cards ── */
        .summary { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 28px; }
        .stat-card {
            background: var(--surface); border: 1px solid var(--border);
            border-radius: 8px; padding: 14px 18px;
            min-width: 130px; flex: 1 1 130px; text-align: center;
            transition: border-color .2s;
        }
        .stat-card:hover { border-color: var(--accent); }
        .stat-label {
            font-size: .68rem; text-transform: uppercase;
            letter-spacing: 1px; color: var(--muted); margin-bottom: 5px;
        }
        .stat-value { font-family: var(--mono); font-size: 1.2rem; font-weight: 700; }

        /* ── Chart sections ── */
        .section-title {
            font-size: .68rem; font-weight: 700; text-transform: uppercase;
            letter-spacing: 1.4px; color: var(--muted); margin-bottom: 14px;
        }
        .chart-container {
            width: 100%; margin-bottom: 24px; padding: 20px;
            background: var(--surface); border: 1px solid var(--border);
            border-radius: 10px;
        }
        h2 { text-align: center; color: var(--accent); font-size: 1rem; margin-bottom: 16px; font-weight: 600; }
        #candleChart { height: 600px; width: 100%; }

        /* ── Trade table ── */
        table { width: 100%; border-collapse: collapse; color: var(--text); margin-top: 8px; }
        th {
            background: var(--surf2); color: var(--accent);
            text-align: left; padding: 10px 14px;
            font-size: .68rem; font-weight: 700;
            text-transform: uppercase; letter-spacing: 1px;
            border-bottom: 1px solid var(--border);
        }
        td { padding: 10px 14px; border-bottom: 1px solid var(--border); font-size: .86rem; }
        tr:hover td { background: rgba(88,166,255,.04); }
        .badge {
            display: inline-block; padding: 2px 8px; border-radius: 20px;
            font-size: .72rem; font-weight: 700; font-family: var(--mono);
        }
        .badge-long  { background: rgba(88,166,255,.15); color: #58a6ff; }
        .badge-short { background: rgba(255,166,87,.15);  color: #ffa657; }
        .badge-tp    { background: rgba(63,185,80,.15);   color: #3fb950; }
        .badge-sl    { background: rgba(239,83,80,.15);   color: #ef5350; }
        .badge-other { background: rgba(139,148,158,.15); color: #8b949e; }
        .mono { font-family: var(--mono); }
    </style>
</head>
<body>
    <div class="container">

        <!-- ─── Page header ─── -->
        <div class="page-header">
            <h1>🚀 Momentum Sniper — Backtest Results</h1>
            <p class="subtitle">Optimized RSI + EMA-${trendPeriod} Strategy &middot; Auto-generated report</p>
        </div>

        <!-- ─── README / GitHub overview panel ─── -->
        <div class="readme-panel">
            <div class="readme-header">
                <span>📄</span>
                <span class="rh-title">README.md</span>
                <span style="margin-left:auto;font-size:.75rem">trading-bots / README.md</span>
            </div>
            <div class="readme-body" id="readmeBody"></div>
        </div>

        <!-- ─── Performance stats ─── -->
        <p class="section-title">📊 Performance Summary</p>
        <div class="summary">
            ${Object.entries(bot.summary())
              .map(
                ([k, v]) => `
                <div class="stat-card">
                    <div class="stat-label">${k.toUpperCase().replace(/_/g, " ")}</div>
                    <div class="stat-value" style="color:${statColor(k, String(v))}">${v}</div>
                </div>`,
              )
              .join("")}
        </div>

        <!-- ─── Candlestick chart ─── -->
        <div class="chart-container">
            <h2>📈 Price Action · EMA-${trendPeriod} &amp; Stop Loss</h2>
            <div id="candleChart"></div>
            <div id="rsiChart" style="height: 220px; width: 100%; margin-top: 15px; border-top: 1px solid var(--border); padding-top: 15px;"></div>
        </div>

        <!-- ─── Trade history ─── -->
        <div class="chart-container">
            <h2>📋 Trade History</h2>
            <table>
                <thead>
                    <tr>
                        <th>#</th><th>Entry Time</th><th>Side</th>
                        <th>Entry $</th><th>Exit $</th>
                        <th>Outcome</th><th>Hold</th><th>PnL</th>
                    </tr>
                </thead>
                <tbody>
                    ${tradeRows
                      .map(
                        (t, i) => `
                        <tr>
                            <td class="mono" style="color:var(--muted)">${i + 1}</td>
                            <td>${t.time}</td>
                            <td><span class="badge badge-${t.side === "LONG" ? "long" : "short"}">${t.side}</span></td>
                            <td class="mono">${t.entryPrice}</td>
                            <td class="mono">${t.exitPrice}</td>
                            <td><span class="badge badge-${t.exitReason === "TP" ? "tp" : t.exitReason === "SL" ? "sl" : "other"}">${t.exitReason}</span></td>
                            <td style="color:var(--muted)">${t.hodlTime}</td>
                            <td class="mono" style="color:${t.pnlColor}">${t.pnl}</td>
                        </tr>`,
                      )
                      .join("")}
                </tbody>
            </table>
        </div>

        <!-- ─── Equity curve ─── -->
        <div class="chart-container">
            <h2>📈 Equity Curve</h2>
            <canvas id="equityChart"></canvas>
        </div>
    </div>

    <script>
        // ── Render README markdown ──────────────────────────────────────────
        const readmeMd = ${JSON.stringify(readmeMd)};
        document.getElementById('readmeBody').innerHTML = marked.parse(readmeMd);

        // ── Charts ─────────────────────────────────────────────────────────
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
                color: '#ef5350', lineWidth: 2,
                lineStyle: LightweightCharts.LineStyle.Dotted,
                title: 'Stop Loss', priceLineVisible: false,
            });
            slSeries.setData(${JSON.stringify(slCurveData)});

            candleSeries.setMarkers(${JSON.stringify(markers)});
            chart.timeScale().fitContent();

            // RSI Chart Setup
            const rsiChartOptions = {
                layout: { background: { color: 'transparent' }, textColor: '#d1d4dc' },
                grid: { vertLines: { color: '#30363d' }, horzLines: { color: '#30363d' } },
                timeScale: { visible: true, timeVisible: true, borderColor: '#30363d' },
                rightPriceScale: { borderColor: '#30363d' },
                crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
            };
            const rsiChart = LightweightCharts.createChart(document.getElementById('rsiChart'), rsiChartOptions);
            const rsiSeries = rsiChart.addLineSeries({ color: '#58a6ff', lineWidth: 2, title: 'RSI' });
            rsiSeries.setData(${JSON.stringify(rsiData)});
            const rsiSmaSeries = rsiChart.addLineSeries({ color: '#e3b341', lineWidth: 2, title: 'RSI SMA' });
            rsiSmaSeries.setData(${JSON.stringify(rsiSmaData)});
            
            const obLine = { price: 60, color: '#ef5350', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: true, title: 'OB' };
            const osLine = { price: 40, color: '#3fb950', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: true, title: 'OS' };
            rsiSeries.createPriceLine(obLine);
            rsiSeries.createPriceLine(osLine);

            chart.timeScale().subscribeVisibleTimeRangeChange(range => { rsiChart.timeScale().setVisibleRange(range); });
            rsiChart.timeScale().subscribeVisibleTimeRangeChange(range => { chart.timeScale().setVisibleRange(range); });

            // Equity Curve Setup
            const ctx = document.getElementById('equityChart').getContext('2d');
            const gradient = ctx.createLinearGradient(0, 0, 0, 400);
            gradient.addColorStop(0, 'rgba(88, 166, 255, 0.4)');
            gradient.addColorStop(1, 'rgba(88, 166, 255, 0.0)');

            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: ${JSON.stringify(downsampledEquityLabels)},
                    datasets: [{
                        label: 'Equity ($)',
                        data: ${JSON.stringify(downsampledEquity)},
                        borderColor: '#58a6ff',
                        fill: true,
                        backgroundColor: gradient,
                        borderWidth: 2,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 6,
                    }]
                },
                options: {
                    responsive: true,
                    interaction: {
                        mode: 'index',
                        intersect: false,
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: { 
                            backgroundColor: '#161b22', 
                            titleColor: '#c9d1d9', 
                            bodyColor: '#58a6ff',
                            borderColor: '#30363d',
                            borderWidth: 1,
                            padding: 10
                        }
                    },
                    scales: {
                        y: { 
                            grid: { color: '#30363d' }, 
                            ticks: { color: '#8b949e', callback: function(value) { return '$' + value; } } 
                        },
                        x: { 
                            grid: { color: 'transparent' }, 
                            ticks: { color: '#8b949e', maxTicksLimit: 12 } 
                        }
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
