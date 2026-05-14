import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.scss'],
})
export class DashboardComponent implements OnInit {
  private api = inject(ApiService);

  stats = [
    { label: 'Total Bots', value: 0 },
    { label: 'Active Bots', value: 0 },
    { label: 'Total Trades', value: 0 },
    { label: 'Total PnL', value: 0 },
  ];

  recentActivity: any[] = [];
  health: any = {};
  error: string | null = null;

  ngOnInit() {
    this.loadHealth();
    this.loadAnalytics();
  }

  private loadHealth() {
    this.api.getHealth().subscribe({
      next: (res: any) => (this.health = res),
      error: () => (this.error = 'Failed to load API health'),
    });
  }

  private loadAnalytics() {
    this.api.getAnalyticsOverview().subscribe({
      next: (res: any) => {
        this.stats[0].value = res.totalBots ?? 0;
        this.stats[1].value = res.activeBots ?? 0;
        this.stats[2].value = res.totalTrades ?? 0;
        this.stats[3].value = res.totalPnl ?? 0;
        this.recentActivity = res.recentActivity ?? [];
      },
      error: () => (this.error = 'Failed to load analytics'),
    });
  }
}
