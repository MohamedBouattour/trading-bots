import { Component, OnInit, inject } from '@angular/core';
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
export class BacktestingComponent implements OnInit {
  private api = inject(ApiService);

  form = {
    asset: 'BTCUSDT',
    timeframe: '1h',
    startDate: '',
    endDate: '',
    initialBalance: 10000,
    strategy: '',
  };

  result: any = null;
  previousRuns: any[] = [];
  running = false;
  error: string | null = null;

  ngOnInit() {
    this.loadPreviousRuns();
  }

  runBacktest() {
    this.running = true;
    this.result = null;
    this.error = null;

    this.api.runBacktest(this.form).subscribe({
      next: (res: any) => {
        this.result = res;
        this.running = false;
        this.loadPreviousRuns();
      },
      error: () => {
        this.error = 'Backtest failed';
        this.running = false;
      },
    });
  }

  private loadPreviousRuns() {
    this.api.getBacktestResults().subscribe({
      next: (res: any) => (this.previousRuns = res),
      error: () => {},
    });
  }
}
