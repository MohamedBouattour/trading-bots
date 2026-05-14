import { Injectable, Logger } from '@nestjs/common';
import { Candle, MarketStats } from '@trading-bots/shared-types';

export const DEFAULT_STOCK_SYMBOLS = [
  'AAPL', 'TSLA', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'META', 'AMD',
  'INTC', 'NFLX', 'DIS', 'BA', 'JPM', 'V', 'JNJ', 'WMT', 'PG', 'KO',
  'PEP', 'XOM', 'CVX', 'CSCO', 'ADBE', 'CRM', 'ORCL', 'IBM', 'QCOM',
  'TXN', 'AVGO', 'PYPL', 'SNAP', 'UBER', 'SQ', 'SHOP', 'RIVN', 'LCID',
  'COIN', 'MARA', 'PLTR', 'SOFI',
];

export type BybitCategory = 'spot' | 'stock' | 'linear' | 'inverse';

@Injectable()
export class BybitClientService {
  private readonly logger = new Logger(BybitClientService.name);
  private apiKey: string = '';
  private secretKey: string = '';
  private baseUrl: string = 'https://api.bybit.com';
  private category: BybitCategory = 'stock';

  configure(apiKey: string, secretKey: string, testnet: boolean = false, category?: BybitCategory) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    if (testnet) {
      this.baseUrl = 'https://api-testnet.bybit.com';
    }
    if (category) this.category = category;
  }

  setCategory(category: BybitCategory) {
    this.category = category;
  }

  private async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };
    if (this.apiKey) {
      headers['X-BAPI-API-KEY'] = this.apiKey;
      const timestamp = Date.now().toString();
      headers['X-BAPI-TIMESTAMP'] = timestamp;
      const sign = await this.sign(timestamp + this.apiKey + '5000');
      headers['X-BAPI-SIGN'] = sign;
      headers['X-BAPI-RECV-WINDOW'] = '5000';
    }
    const response = await fetch(url, { ...options, headers });
    return response.json();
  }

  private async sign(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(this.secretKey);
    const msgData = encoder.encode(data);
    const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
    return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async getKline(symbol: string, interval: string, limit: number = 200): Promise<Candle[]> {
    const response = await this.request(`/v5/market/kline?category=${this.category}&symbol=${symbol}&interval=${interval}&limit=${limit}`);
    if (response.retCode !== 0) {
      this.logger.error(`Failed to fetch kline: ${response.retMsg}`);
      return [];
    }
    return (response.result?.list || []).map((item: string[]) => ({
      timestamp: new Date(parseInt(item[0]) * 1000),
      open: parseFloat(item[1]),
      high: parseFloat(item[2]),
      low: parseFloat(item[3]),
      close: parseFloat(item[4]),
      volume: parseFloat(item[5]),
      symbol,
      timeframe: interval,
    })).reverse();
  }

  async getTickers(symbol: string): Promise<MarketStats | null> {
    const response = await this.request(`/v5/market/tickers?category=${this.category}&symbol=${symbol}`);
    if (response.retCode !== 0 || !response.result?.list?.[0]) return null;
    const t = response.result.list[0];
    return {
      symbol,
      currentPrice: parseFloat(t.lastPrice),
      priceChange24h: parseFloat(t.price24hPcnt) * 100,
      volume24h: parseFloat(t.volume24h),
      high24h: parseFloat(t.highPrice24h),
      low24h: parseFloat(t.lowPrice24h),
    };
  }

  async placeOrder(symbol: string, side: 'Buy' | 'Sell', orderType: 'Market' | 'Limit', qty: string, price?: string) {
    const body: Record<string, any> = {
      category: this.category,
      symbol,
      side,
      orderType,
      qty,
      timeInForce: 'GTC',
    };
    if (price) body.price = price;
    const response = await this.request(`/v5/order/create`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (response.retCode !== 0) {
      this.logger.error(`Order failed: ${response.retMsg}`);
    }
    return response;
  }

  async getAccountBalance(accountType: string = 'UNIFIED'): Promise<any> {
    const response = await this.request(`/v5/account/wallet-balance?accountType=${accountType}`);
    return response;
  }

  async getOpenPositions(symbol: string): Promise<any> {
    const response = await this.request(`/v5/position/list?category=${this.category}&symbol=${symbol}`);
    return response;
  }

  async getSymbols(): Promise<string[]> {
    try {
      const response = await this.request(`/v5/market/instruments-info?category=${this.category}&limit=1000`);
      if (response.retCode === 0 && response.result?.list) {
        const symbols = (response.result.list as any[])
          .filter((i: any) => i.status === 'Trading')
          .map((i: any) => i.symbol);
        if (symbols.length > 0) return symbols;
      }
    } catch {
      this.logger.warn('Failed to fetch symbols from Bybit, using defaults');
    }
    return DEFAULT_STOCK_SYMBOLS;
  }

  getTimeframes(): string[] {
    return ['1', '3', '5', '15', '30', '60', '120', '240', '360', '720', 'D', 'W', 'M'];
  }

  getTimeframeLabel(tf: string): string {
    const labels: Record<string, string> = {
      '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m',
      '60': '1h', '120': '2h', '240': '4h', '360': '6h', '720': '12h',
      'D': '1d', 'W': '1w', 'M': '1M',
    };
    return labels[tf] || tf;
  }

  async getKlineRange(symbol: string, interval: string, start: number, end: number): Promise<Candle[]> {
    const limit = 1000;
    const allCandles: Candle[] = [];
    let currentStart = start;

    while (currentStart < end) {
      const response = await this.request(
        `/v5/market/kline?category=${this.category}&symbol=${symbol}&interval=${interval}&limit=${limit}&start=${currentStart}`
      );
      if (response.retCode !== 0 || !response.result?.list) break;

      const batch = (response.result.list as string[][]).map((item: string[]) => ({
        timestamp: new Date(parseInt(item[0]) * 1000),
        open: parseFloat(item[1]),
        high: parseFloat(item[2]),
        low: parseFloat(item[3]),
        close: parseFloat(item[4]),
        volume: parseFloat(item[5]),
        symbol,
        timeframe: interval,
      })).reverse();

      if (batch.length === 0) break;
      allCandles.push(...batch);
      const lastTs = parseInt(response.result.list[response.result.list.length - 1][0]) * 1000;
      currentStart = lastTs;
    }

    return allCandles;
  }

  calculateRSI(candles: Candle[], period: number = 14): number {
    if (candles.length < period + 1) return 50;
    const gains: number[] = [];
    const losses: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const diff = candles[i].close - candles[i - 1].close;
      gains.push(diff > 0 ? diff : 0);
      losses.push(diff < 0 ? -diff : 0);
    }
    const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  calculateSMA(candles: Candle[], period: number): number {
    if (candles.length < period) return candles[candles.length - 1].close;
    return candles.slice(-period).reduce((sum, c) => sum + c.close, 0) / period;
  }

  calculateEMA(candles: Candle[], period: number): number {
    if (candles.length < period) return candles[candles.length - 1].close;
    const multiplier = 2 / (period + 1);
    let ema = candles.slice(0, period).reduce((sum, c) => sum + c.close, 0) / period;
    for (let i = period; i < candles.length; i++) {
      ema = (candles[i].close - ema) * multiplier + ema;
    }
    return ema;
  }
}
