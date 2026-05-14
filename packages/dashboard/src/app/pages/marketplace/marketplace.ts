import { Component, OnInit, inject, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
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
export class MarketplaceComponent implements OnInit, AfterViewChecked {
  private api = inject(ApiService);

  @ViewChild('diagramCanvas') diagramCanvas!: ElementRef<HTMLCanvasElement>;

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

  selectedStrategy: any = null;
  private needsDiagramRender = false;

  ngOnInit() {
    this.loadStrategies();
  }

  ngAfterViewChecked() {
    if (this.needsDiagramRender && this.selectedStrategy) {
      this.renderDiagram();
      this.needsDiagramRender = false;
    }
  }

  private loadStrategies() {
    this.api.getMarketplaceStrategies(this.sortField).subscribe({
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

  openStrategy(strategy: any) {
    this.selectedStrategy = strategy;
    this.needsDiagramRender = true;
  }

  closeStrategy() {
    this.selectedStrategy = null;
    this.needsDiagramRender = false;
  }

  getLogic(strategy: any): any {
    return strategy?.strategy?.config?.logicDescription || {};
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

  private renderDiagram() {
    const canvas = this.diagramCanvas?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    const logic = this.getLogic(this.selectedStrategy);
    const steps = logic.diagramSteps;
    if (!steps?.length) return;

    const boxW = 160;
    const boxH = 40;
    const condSize = 50;
    const gap = 60;
    const startY = 20;
    const totalH = steps.length * (boxH + gap) - gap + startY + 20;

    const bandColor = logic.color || '#e8e8e8';

    ctx.fillStyle = bandColor;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, totalH, 12);
    ctx.fill();

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const midX = w / 2;
      const isCond = step.isCondition === true;

      let x: number, y: number, nodeW: number, nodeH: number;

      if (isCond) {
        nodeW = condSize;
        nodeH = condSize;
        x = midX - nodeW / 2;
        y = startY + i * (boxH + gap) + (boxH - nodeH) / 2;

        ctx.save();
        ctx.translate(midX, y + nodeH / 2);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.roundRect(-nodeW / 2 + 4, -nodeH / 2 + 4, nodeW - 8, nodeH - 8, 4);
        ctx.fill();
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(-nodeW / 2 + 4, -nodeH / 2 + 4, nodeW - 8, nodeH - 8, 4);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = '#92400e';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lines = this.wrapText(ctx, step.label, nodeW - 16);
        lines.forEach((line, li) => {
          ctx.fillText(line, midX, y + nodeH / 2 - (lines.length - 1) * 7 + li * 14);
        });
      } else {
        nodeW = boxW;
        nodeH = boxH;
        x = midX - nodeW / 2;
        y = startY + i * (boxH + gap);

        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.roundRect(x, y, nodeW, nodeH, 8);
        ctx.fill();
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x, y, nodeW, nodeH, 8);
        ctx.stroke();

        ctx.fillStyle = '#334155';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const lines = this.wrapText(ctx, step.label, nodeW - 16);
        lines.forEach((line, li) => {
          ctx.fillText(line, midX, y + nodeH / 2 - (lines.length - 1) * 7 + li * 14);
        });

        if (step.formula) {
          ctx.fillStyle = '#64748b';
          ctx.font = '9px sans-serif';
          ctx.fillText(step.formula, midX, y + nodeH + 12);
        }
      }

      if (i < steps.length - 1) {
        const nextY = y + nodeH + gap / 2;
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(midX, y + nodeH);
        ctx.lineTo(midX, nextY);
        ctx.stroke();

        ctx.fillStyle = '#6366f1';
        ctx.font = '14px sans-serif';
        ctx.fillText('↓', midX, nextY + 6);
      }
    }
  }

  private wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const test = line + (line ? ' ' : '') + word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [text];
  }
}
