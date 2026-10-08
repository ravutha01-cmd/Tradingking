/* Records candle history (Binance PAXG/USDT, since Aug 2020). The CRT lab records
 * 1H candles and builds New York-aligned 4H candles from them (see sessions.js).
 * Downloads everything once, then only appends new candles. In the browser the
 * data is kept in localStorage; Node scripts can call fetchRange directly. */
(function (root) {
  'use strict';
  const REST = 'https://data-api.binance.vision/api/v3/klines';
  const SYMBOL = 'PAXGUSDT';
  const INTERVAL_MS = { '5m': 300e3, '15m': 900e3, '30m': 1800e3, '1h': 3600e3, '4h': 4 * 3600e3, '1d': 86400e3 };
  const KEY = (interval) => `tradingking.candles.${SYMBOL}.${interval}`;

  async function fetchRange(interval, startTime, onProgress) {
    const out = [];
    let start = startTime;
    const now = Date.now();
    for (;;) {
      const res = await fetch(`${REST}?symbol=${SYMBOL}&interval=${interval}&startTime=${start}&limit=1000`);
      if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
      const rows = await res.json();
      for (const k of rows) {
        out.push({ time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], closed: k[6] < Date.now() });
      }
      if (onProgress && rows.length) onProgress(rows[rows.length - 1][0]);
      if (rows.length < 1000) break;
      start = rows[rows.length - 1][0] + INTERVAL_MS[interval];
      if (start > now) break;
    }
    return out;
  }

  // Compact storage (~2 MB for all 1H history): [hours since epoch, open, high, low, close].
  const H = 3600e3;
  function load(interval) {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY(interval)) || '[]');
      return raw.map((a) => ({ time: a[0] * H, open: a[1], high: a[2], low: a[3], close: a[4], volume: 0, closed: true }));
    } catch { return []; }
  }

  function store(interval, candles) {
    try {
      if (interval === '1h') localStorage.removeItem(KEY('4h')); // older versions recorded UTC 4H candles
      localStorage.setItem(KEY(interval), JSON.stringify(
        candles.filter((c) => c.closed).map((c) => [c.time / H, c.open, c.high, c.low, c.close])));
      return true;
    } catch { return false; }
  }

  // Load what is recorded, fetch anything newer, save. Returns all candles incl. the forming one.
  async function sync(interval = '1h', onProgress) {
    const have = typeof localStorage !== 'undefined' ? load(interval) : [];
    const since = have.length ? have[have.length - 1].time + INTERVAL_MS[interval] : 0;
    const fresh = await fetchRange(interval, since, onProgress);
    const candles = have.concat(fresh.filter((c) => !have.length || c.time > have[have.length - 1].time));
    const saved = typeof localStorage !== 'undefined' ? store(interval, candles) : false;
    return { candles, added: fresh.filter((c) => c.closed).length, saved };
  }

  // CSV of closed candles; NY-aligned candles also get their New York open hour.
  function toCSV(candles) {
    const ny = candles.length && candles[0].nyHour != null;
    return `time_utc,${ny ? 'ny_hour,' : ''}open,high,low,close\n` + candles.filter((c) => c.closed)
      .map((c) => `${new Date(c.time).toISOString()},${ny ? c.nyHour + ',' : ''}${c.open},${c.high},${c.low},${c.close}`).join('\n') + '\n';
  }

  function clear(interval) { try { localStorage.removeItem(KEY(interval)); } catch { /* ignore */ } }

  const api = { fetchRange, load, store, sync, toCSV, clear, SYMBOL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.History = api;
})(typeof window !== 'undefined' ? window : globalThis);
