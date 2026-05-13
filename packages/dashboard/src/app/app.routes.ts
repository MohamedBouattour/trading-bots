import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.DashboardComponent),
  },
  {
    path: 'bots',
    loadComponent: () => import('./pages/bots/bot-list').then(m => m.BotListComponent),
  },
  {
    path: 'bots/:id',
    loadComponent: () => import('./pages/bots/bot-detail').then(m => m.BotDetailComponent),
  },
  {
    path: 'backtesting',
    loadComponent: () => import('./pages/backtesting/backtesting').then(m => m.BacktestingComponent),
  },
  {
    path: 'analytics',
    loadComponent: () => import('./pages/analytics/analytics').then(m => m.AnalyticsComponent),
  },
  {
    path: 'marketplace',
    loadComponent: () => import('./pages/marketplace/marketplace').then(m => m.MarketplaceComponent),
  },
];
