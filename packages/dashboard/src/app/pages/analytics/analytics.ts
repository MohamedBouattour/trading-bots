import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './analytics.html',
  styleUrls: ['./analytics.scss'],
})
export class AnalyticsComponent implements OnInit {
  private api = inject(ApiService);

  stats = [
    { label: 'Total Trades', value: 0 },
    { label: 'Win Rate', value: '0%' },
    { label: 'Total PnL', value: 0 },
    { label: 'Best Day', value: 0 },
  ];

  tradeHistory: any[] = [];
  pnlDaily: any[] = [];
  marketData: any = null;

  tradeFilter = { botId: '', symbol: '', status: '' };
  marketSymbol = 'BTCUSDT';

  error: string | null = null;

  ngOnInit() {
    this.loadOverview();
    this.loadTradeHistory();
  }

  private loadOverview() {
    this.api.getAnalyticsOverview().subscribe({
      next: (res: any) => {
        this.stats[0].value = res.totalTrades ?? 0;
        this.stats[1].value = (res.winRate ?? 0) + '%';
        this.stats[2].value = res.totalPnl ?? 0;
        this.stats[3].value = res.bestDay ?? 0;
        this.pnlDaily = res.dailyPnl ?? [];
      },
      error: () => (this.error = 'Failed to load overview'),
    });
  }

  loadTradeHistory() {
    this.api.getTradeHistory(this.tradeFilter).subscribe({
      next: (res: any) => (this.tradeHistory = res),
      error: () => (this.error = 'Failed to load trade history'),
    });
  }

  loadMarketData() {
    this.api.getMarketData(this.marketSymbol).subscribe({
      next: (res: any) => (this.marketData = res),
      error: () => (this.error = 'Failed to load market data'),
    });
  }

  trackById(_index: number, item: any) {
    return item.id;
  }
}
