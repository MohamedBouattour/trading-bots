import axios from 'axios';
import crypto from 'crypto';
import type { IMarketDataProvider } from '../../application/ports/IMarketDataProvider.js';
import type { ITradeExecutor } from '../../application/ports/ITradeExecutor.js';
import type { Candle } from '../../domain/models/Candle.js';
import type { ActionType, ActionParams } from '../../domain/models/StrategyBlueprint.js';
import type { TradeRecord } from '../../domain/models/TradeRecord.js';

const FUTURES_BASE = 'https://fapi.binance.com';
const TESTNET_BASE = 'https://testnet.binancefuture.com';

export class BinanceAdapter implements IMarketDataProvider, ITradeExecutor {
  private base: string;

  constructor(
    private apiKey: string,
    private secretKey: string,
    testnet = false
  ) {
    this.base = testnet ? TESTNET_BASE : FUTURES_BASE;
  }

  async getCandles(symbol: string, timeframe: string, limit = 250): Promise<Candle[]> {
    const { data } = await axios.get(`${this.base}/fapi/v1/klines`, {
      params: { symbol, interval: timeframe, limit },
    });
    return (data as unknown[][]).map((k) => ({
      symbol,
      timeframe,
      openTime: Number(k[0]),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      closeTime: Number(k[6]),
    }));
  }

  async getLatestPrice(symbol: string): Promise<number> {
    const { data } = await axios.get(`${this.base}/fapi/v1/ticker/price`, { params: { symbol } });
    return Number((data as { price: string }).price);
  }

  async getAccountBalance(): Promise<number> {
    const timestamp = Date.now();
    const query = `timestamp=${timestamp}`;
    const signature = crypto.createHmac('sha256', this.secretKey).update(query).digest('hex');
    const { data } = await axios.get(`${this.base}/fapi/v2/balance`, {
      params: { timestamp, signature },
      headers: { 'X-MBX-APIKEY': this.apiKey },
    });
    const usdt = (data as { asset: string; availableBalance: string }[]).find((b) => b.asset === 'USDT');
    return usdt ? Number(usdt.availableBalance) : 0;
  }

  async execute(
    symbol: string,
    action: ActionType,
    params: ActionParams,
    currentPrice: number,
    balance: number
  ): Promise<TradeRecord> {
    const notional = params.sizeMode === 'fixed_usd'
      ? params.sizeValue
      : (params.sizeValue / 100) * balance;
    const quantity = notional / currentPrice;
    const side = action === 'BUY' ? 'BUY' : 'SELL';
    const timestamp = Date.now();

    const bodyParams = [
      `symbol=${symbol}`,
      `side=${side}`,
      `type=MARKET`,
      `quantity=${quantity.toFixed(6)}`,
      `timestamp=${timestamp}`,
      ...(params.leverage ? [`leverage=${params.leverage}`] : []),
    ].join('&');

    const signature = crypto.createHmac('sha256', this.secretKey).update(bodyParams).digest('hex');

    await axios.post(`${this.base}/fapi/v1/order`, `${bodyParams}&signature=${signature}`, {
      headers: { 'X-MBX-APIKEY': this.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    return {
      id: `${symbol}-${timestamp}`,
      strategyId: '',
      symbol,
      direction: action === 'BUY' ? 'LONG' : 'SHORT',
      status: 'OPEN',
      entryPrice: currentPrice,
      quantity,
      leverage: params.leverage ?? 1,
      entryTime: timestamp,
      triggeredRuleId: '',
    };
  }

  async closePosition(trade: TradeRecord, currentPrice: number): Promise<TradeRecord> {
    const closeSide = trade.direction === 'LONG' ? 'SELL' : 'BUY';
    const timestamp = Date.now();
    const bodyParams = [
      `symbol=${trade.symbol}`,
      `side=${closeSide}`,
      `type=MARKET`,
      `quantity=${trade.quantity.toFixed(6)}`,
      `timestamp=${timestamp}`,
    ].join('&');
    const signature = crypto.createHmac('sha256', this.secretKey).update(bodyParams).digest('hex');
    await axios.post(`${this.base}/fapi/v1/order`, `${bodyParams}&signature=${signature}`, {
      headers: { 'X-MBX-APIKEY': this.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const pnlUsd =
      trade.direction === 'LONG'
        ? (currentPrice - trade.entryPrice) * trade.quantity * trade.leverage
        : (trade.entryPrice - currentPrice) * trade.quantity * trade.leverage;
    const pnlPct = (pnlUsd / (trade.entryPrice * trade.quantity)) * 100;

    return {
      ...trade,
      status: 'CLOSED',
      exitPrice: currentPrice,
      exitTime: timestamp,
      pnlUsd,
      pnlPct,
    };
  }
}
