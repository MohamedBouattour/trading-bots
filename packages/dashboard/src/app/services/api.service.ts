import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private apiBase = 'http://localhost:3000/api';
  private backtesterBase = 'http://localhost:3000/api';

  getHealth(): Observable<any> {
    return this.http.get(`${this.apiBase}/health`);
  }

  getBots(): Observable<any> {
    return this.http.get(`${this.apiBase}/bots`);
  }

  createBot(data: any): Observable<any> {
    return this.http.post(`${this.apiBase}/bots`, data);
  }

  getBot(id: string): Observable<any> {
    return this.http.get(`${this.apiBase}/bots/${id}`);
  }

  updateBot(id: string, data: any): Observable<any> {
    return this.http.patch(`${this.apiBase}/bots/${id}`, data);
  }

  deleteBot(id: string): Observable<any> {
    return this.http.delete(`${this.apiBase}/bots/${id}`);
  }

  startBot(id: string): Observable<any> {
    return this.http.patch(`${this.apiBase}/bots/${id}`, { active: true });
  }

  stopBot(id: string): Observable<any> {
    return this.http.patch(`${this.apiBase}/bots/${id}`, { active: false });
  }

  getTrades(botId?: string): Observable<any> {
    const params = botId ? { botId } : undefined;
    return this.http.get(`${this.apiBase}/trades`, { params });
  }

  getLogs(botId?: string): Observable<any> {
    const params = botId ? { botId } : undefined;
    return this.http.get(`${this.apiBase}/logs`, { params });
  }

  getSymbols(): Observable<string[]> {
    return this.http.get<string[]>(`${this.backtesterBase}/backtest/symbols`);
  }

  getTimeframes(): Observable<{ value: string; label: string }[]> {
    return this.http.get<{ value: string; label: string }[]>(`${this.backtesterBase}/backtest/timeframes`);
  }

  getBacktestStrategies(): Observable<any[]> {
    return this.http.get<any[]>(`${this.backtesterBase}/backtest/strategies`);
  }

  runBacktest(data: any): Observable<any> {
    return this.http.post(`${this.backtesterBase}/backtest`, data);
  }

  getBacktestResult(id: string): Observable<any> {
    return this.http.get(`${this.backtesterBase}/backtest/${id}`);
  }

  getBacktestRuns(): Observable<any> {
    return this.http.get(`${this.backtesterBase}/backtest`);
  }

  getBacktestEquityCurve(id: string): Observable<any> {
    return this.http.get(`${this.backtesterBase}/backtest/${id}/equity-curve`);
  }

  getAnalyticsOverview(): Observable<any> {
    return this.http.get(`${this.apiBase}/analytics/overview`);
  }

  getBotStats(id: string): Observable<any> {
    return this.http.get(`${this.apiBase}/analytics/bot/${id}`);
  }

  getTradesAnalytics(filters?: any): Observable<any> {
    return this.http.get(`${this.apiBase}/analytics/trades`, { params: filters });
  }

  getPnl(days: number): Observable<any> {
    return this.http.get(`${this.apiBase}/analytics/pnl`, { params: { days } });
  }

  getMarketData(symbol: string): Observable<any> {
    return this.http.get(`${this.apiBase}/analytics/market/${symbol}`);
  }

  getMarketplaceStrategies(sort?: string): Observable<any> {
    const params = sort ? { sort } : undefined;
    return this.http.get(`${this.apiBase}/marketplace/strategies`, { params });
  }

  getBestRoi(): Observable<any> {
    return this.http.get(`${this.apiBase}/marketplace/strategies/best-roi`);
  }

  getFastestGrowing(): Observable<any> {
    return this.http.get(`${this.apiBase}/marketplace/strategies/fastest-growing`);
  }

  getMarketplaceStrategy(id: string): Observable<any> {
    return this.http.get(`${this.apiBase}/marketplace/strategies/${id}`);
  }

  publishStrategy(data: any): Observable<any> {
    return this.http.post(`${this.apiBase}/marketplace/publish`, data);
  }

  downloadStrategy(id: string): Observable<any> {
    return this.http.post(`${this.apiBase}/marketplace/download/${id}`, {});
  }
}
