/* Live market data feeds. Each feed exposes:
 *   fetchCandles(interval, limit) -> Promise<Candle[]>
 *   subscribe(interval, onCandle) -> unsubscribe()
 * Candle = { time (ms, open time), open, high, low, close, volume, closed } */
(function (root) {
  'use strict';

  // Binance public market-data mirror (no API key, CORS enabled).
  // PAXG is a token backed 1:1 by a fine troy ounce of LBMA gold, so it tracks XAU/USD closely.
  const BinanceFeed = {
    id: 'binance',
    label: 'Gold (PAXG/USDT, Binance – live stream)',
    rest: 'https://data-api.binance.vision/api/v3/klines',
    ws: 'wss://data-stream.binance.vision/ws',
    symbol: 'PAXGUSDT',

    async fetchCandles(interval, limit = 500) {
      const url = `${this.rest}?symbol=${this.symbol}&interval=${interval}&limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
      const rows = await res.json();
      const now = Date.now();
      return rows.map((k) => ({
        time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
        closed: k[6] < now,
      }));
    },

    subscribe(interval, onCandle, onStatus) {
      let ws, closedByUser = false, retry = 1000;
      const connect = () => {
        ws = new WebSocket(`${this.ws}/${this.symbol.toLowerCase()}@kline_${interval}`);
        ws.onopen = () => { retry = 1000; onStatus && onStatus('live'); };
        ws.onmessage = (ev) => {
          const k = JSON.parse(ev.data).k;
          if (!k) return;
          onCandle({ time: k.t, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v, closed: k.x });
        };
        ws.onclose = () => {
          if (closedByUser) return;
          onStatus && onStatus('reconnecting');
          setTimeout(connect, retry);
          retry = Math.min(retry * 2, 30000);
        };
        ws.onerror = () => ws.close();
      };
      connect();
      return () => { closedByUser = true; ws && ws.close(); };
    },
  };

  // Twelve Data spot XAU/USD (free API key from twelvedata.com). Polled, since the
  // free tier has no websocket. Free plan: 8 requests/min, 800/day.
  const TWELVE_INTERVALS = { '1m': '1min', '5m': '5min', '15m': '15min', '1h': '1h', '4h': '4h', '1d': '1day' };
  const TwelveDataFeed = {
    id: 'twelvedata',
    label: 'Spot XAU/USD (Twelve Data – API key)',
    apiKey: '',
    pollMs: 60000,

    async fetchCandles(interval, limit = 500) {
      if (!this.apiKey) throw new Error('Twelve Data API key required');
      const url = `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${TWELVE_INTERVALS[interval]}` +
        `&outputsize=${limit}&timezone=UTC&order=ASC&apikey=${encodeURIComponent(this.apiKey)}`;
      const res = await fetch(url);
      const body = await res.json();
      if (body.status === 'error') throw new Error(`Twelve Data: ${body.message}`);
      // The most recent bar is still forming.
      return body.values.map((v, i, all) => ({
        time: Date.parse(v.datetime.replace(' ', 'T') + 'Z'),
        open: +v.open, high: +v.high, low: +v.low, close: +v.close, volume: +(v.volume || 0),
        closed: i < all.length - 1,
      }));
    },

    subscribe(interval, onCandle, onStatus) {
      let stopped = false;
      const tick = async () => {
        if (stopped) return;
        try {
          const rows = await this.fetchCandles(interval, 2);
          rows.forEach(onCandle);
          onStatus && onStatus('live');
        } catch (e) {
          onStatus && onStatus('error');
        }
      };
      const timer = setInterval(tick, this.pollMs);
      onStatus && onStatus('live');
      return () => { stopped = true; clearInterval(timer); };
    },
  };

  root.Feeds = { binance: BinanceFeed, twelvedata: TwelveDataFeed };
})(window);
