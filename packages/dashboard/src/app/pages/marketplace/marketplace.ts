import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-marketplace',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './marketplace.html',
  styleUrls: ['./marketplace.scss'],
})
export class MarketplaceComponent implements OnInit {
  private api = inject(ApiService);

  allStrategies: any[] = [];
  bestRoi: any[] = [];
  fastestGrowing: any[] = [];

  sortField = 'monthlyROI';
  error: string | null = null;

  publishForm = {
    strategyId: '',
    name: '',
    description: '',
  };
  showPublishForm = false;

  ngOnInit() {
    this.loadStrategies();
  }

  private loadStrategies() {
    this.api.getMarketplaceStrategies({ sort: this.sortField }).subscribe({
      next: (res: any) => {
        this.allStrategies = res.all ?? [];
        this.bestRoi = res.bestRoi ?? [];
        this.fastestGrowing = res.fastestGrowing ?? [];
      },
      error: () => (this.error = 'Failed to load strategies'),
    });
  }

  sortBy(field: string) {
    this.sortField = field;
    this.loadStrategies();
  }

  publishStrategy() {
    this.api.publishStrategy(this.publishForm).subscribe({
      next: () => {
        this.showPublishForm = false;
        this.publishForm = { strategyId: '', name: '', description: '' };
        this.loadStrategies();
      },
      error: () => (this.error = 'Failed to publish strategy'),
    });
  }

  trackById(_index: number, item: any) {
    return item.id;
  }
}
