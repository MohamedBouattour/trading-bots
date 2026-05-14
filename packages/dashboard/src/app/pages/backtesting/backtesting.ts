import { Component, OnInit, inject, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-backtesting',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './backtesting.html',
  styleUrls: ['./backtesting.scss'],
})
export class BacktestingComponent implements OnInit, AfterViewChecked {
  private api = inject(ApiService);

  @ViewChild('chartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;

  symbols: string[] = [];
  timeframes: { value: string; label: string }[] = [];
  strategies: any[] = [];

  form = {
    asset: 'AAPL',
    timeframe: 'D',
    startDate: '',
    endDate: '',
    initialBalance: 10000,
    strategyId: '',
  };

  selectedShortcut: string | null = null;

  result: any = null;
  previousRuns: any[] = [];
  running = false;
  error: string | null = null;
  loadingData = true;

  private needsChartRender = false;

  ngOnInit() {
    this.loadInitialData();
  }

  ngAfterViewChecked() {
    if (this.needsChartRender && this.result?.equityCurve?.length) {
      this.renderChart();
      this.needsChartRender = false;
    }
  }

  private loadInitialData() {
    this.loadingData = true;
    this.api.getSymbols().subscribe({
      next: (s) => {
        this.symbols = s;
        if (s.length && !s.includes(this.form.asset)) this.form.asset = s[0];
      },
    });
    this.api.getTimeframes().subscribe({
      next: (t) => {
        this.timeframes = t;
      },
    });
    this.api.getBacktestStrategies().subscribe({
      next: (st) => {
        this.strategies = st;
        if (st.length) this.form.strategyId = st[0].id;
        this.loadingData = false;
      },
      error: () => { this.loadingData = false; },
    });
    this.loadPreviousRuns();
  }

  setDateShortcut(months: number) {
    this.selectedShortcut = months.toString();
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - months);
    this.form.startDate = this.toDateStr(start);
    this.form.endDate = this.toDateStr(end);
  }

  private toDateStr(d: Date): string {
    return d.toISOString().split('T')[0];
  }

  runBacktest() {
    if (!this.form.strategyId) {
      this.error = 'Please select a strategy';
      return;
    }
    this.running = true;
    this.result = null;
    this.error = null;

    this.api.runBacktest(this.form).subscribe({
      next: (res: any) => {
        this.result = res;
        this.running = false;
        this.needsChartRender = true;
        this.loadPreviousRuns();
      },
      error: (err) => {
        this.error = err.error?.message || 'Backtest failed';
        this.running = false;
      },
    });
  }

  private loadPreviousRuns() {
    this.api.getBacktestRuns().subscribe({
      next: (res: any) => (this.previousRuns = res),
      error: () => {},
    });
  }

  strategyName(id: string): string {
    return this.strategies.find(s => s.id === id)?.name || id;
  }

  private renderChart() {
    const canvas = this.chartCanvas?.nativeElement;
    if (!canvas || !this.result?.equityCurve) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width;
    const h = rect.height;

    const curve = this.result.equityCurve as { date: string; value: number }[];
    if (curve.length < 2) return;

    const values = curve.map(p => p.value);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal || 1;
    const padding = { top: 20, bottom: 30, left: 60, right: 20 };

    ctx.clearRect(0, 0, w, h);

    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;

    const fillColor = this.result.totalReturn >= 0
      ? 'rgba(46, 125, 50, 0.1)'
      : 'rgba(198, 40, 40, 0.1)';
    const strokeColor = this.result.totalReturn >= 0
      ? '#2e7d32'
      : '#c62828';

    ctx.beginPath();
    curve.forEach((p, i) => {
      const x = padding.left + (i / (curve.length - 1)) * plotW;
      const y = padding.top + plotH - ((p.value - minVal) / range) * plotH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    const lastX = padding.left + plotW;
    ctx.lineTo(lastX, padding.top + plotH);
    ctx.lineTo(padding.left, padding.top + plotH);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    ctx.beginPath();
    curve.forEach((p, i) => {
      const x = padding.left + (i / (curve.length - 1)) * plotW;
      const y = padding.top + plotH - ((p.value - minVal) / range) * plotH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#666';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`$${minVal.toFixed(0)}`, padding.left - 5, padding.top + plotH + 4);
    ctx.fillText(`$${maxVal.toFixed(0)}`, padding.left - 5, padding.top + 4);

    ctx.textAlign = 'center';
    const firstDate = new Date(curve[0].date);
    const lastDate = new Date(curve[curve.length - 1].date);
    ctx.fillText(firstDate.toLocaleDateString(), padding.left, h - 5);
    ctx.fillText(lastDate.toLocaleDateString(), padding.left + plotW, h - 5);
  }
}
