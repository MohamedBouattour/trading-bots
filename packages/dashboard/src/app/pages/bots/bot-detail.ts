import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-bot-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './bot-detail.html',
  styleUrls: ['./bot-detail.scss'],
})
export class BotDetailComponent implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  bot: any = null;
  trades: any[] = [];
  logs: any[] = [];
  error: string | null = null;

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadBot(id);
      this.loadTrades(id);
      this.loadLogs(id);
    }
  }

  private loadBot(id: string) {
    this.api.getBot(id).subscribe({
      next: (res: any) => (this.bot = res),
      error: () => (this.error = 'Failed to load bot'),
    });
  }

  private loadTrades(id: string) {
    this.api.getBotTrades(id).subscribe({
      next: (res: any) => (this.trades = res),
      error: () => (this.error = 'Failed to load trades'),
    });
  }

  private loadLogs(id: string) {
    this.api.getBotLogs(id).subscribe({
      next: (res: any) => (this.logs = res),
      error: () => (this.error = 'Failed to load logs'),
    });
  }

  goBack() {
    this.router.navigate(['/bots']);
  }

  trackById(_index: number, item: any) {
    return item.id;
  }
}
