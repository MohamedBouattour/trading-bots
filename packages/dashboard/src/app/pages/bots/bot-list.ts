import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-bot-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './bot-list.html',
  styleUrls: ['./bot-list.scss'],
})
export class BotListComponent implements OnInit {
  private api = inject(ApiService);
  private router = inject(Router);

  bots: any[] = [];
  showCreateForm = false;
  newBot = { name: '', asset: '', timeframe: '', initialBalance: 1000 };
  error: string | null = null;

  ngOnInit() {
    this.loadBots();
  }

  private loadBots() {
    this.api.getBots().subscribe({
      next: (res: any) => (this.bots = res),
      error: () => (this.error = 'Failed to load bots'),
    });
  }

  toggleBot(bot: any) {
    const obs = bot.active ? this.api.stopBot(bot.id) : this.api.startBot(bot.id);
    obs.subscribe({
      next: () => this.loadBots(),
      error: () => (this.error = 'Failed to toggle bot'),
    });
  }

  createBot() {
    this.api.createBot(this.newBot).subscribe({
      next: () => {
        this.showCreateForm = false;
        this.newBot = { name: '', asset: '', timeframe: '', initialBalance: 1000 };
        this.loadBots();
      },
      error: () => (this.error = 'Failed to create bot'),
    });
  }

  viewDetail(id: string) {
    this.router.navigate(['/bots', id]);
  }

  trackById(_index: number, bot: any) {
    return bot.id;
  }
}
