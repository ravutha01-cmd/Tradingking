/* New York session time helpers.
 *
 * Gold (XAU/USD) on forex charts — e.g. OANDA:XAUUSD on TradingView — uses a trading
 * day that runs 17:00 → 17:00 New York time, with 4H candles opening at
 * 17:00, 21:00, 01:00, 05:00, 09:00 and 13:00 NY. The market is closed from Friday
 * 17:00 to Sunday 17:00 NY. Binance 4H candles open at 00:00 UTC instead, so CRT
 * session times (the 1 AM / 5 AM / 9 AM NY candles) do not line up with them; we
 * build NY-aligned 4H candles from 1H data here. Times handle US daylight saving. */
(function (root) {
  'use strict';
  const HOUR = 3600e3, DAY = 24 * HOUR;
  const SHIFT = 7 * HOUR; // NY local + 7h puts the 17:00 NY day start at 00:00

  // n-th Sunday (1-based) of a UTC month, as a UTC midnight timestamp.
  function nthSunday(year, month, n) {
    const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
    return Date.UTC(year, month, 1 + ((7 - first) % 7) + (n - 1) * 7);
  }

  // NY offset from UTC in ms (-4h during daylight saving, -5h otherwise).
  // DST: second Sunday of March 02:00 EST (07:00 UTC) → first Sunday of November 02:00 EDT (06:00 UTC).
  function nyOffset(utc) {
    const y = new Date(utc).getUTCFullYear();
    const start = nthSunday(y, 2, 2) + 7 * HOUR;
    const end = nthSunday(y, 10, 1) + 6 * HOUR;
    return utc >= start && utc < end ? -4 * HOUR : -5 * HOUR;
  }

  const shifted = (utc) => utc + nyOffset(utc) + SHIFT;
  const nyHour = (utc) => new Date(utc + nyOffset(utc)).getUTCHours();
  // Trading-day number (changes at 17:00 NY) and week number (weeks start Sunday 17:00 NY).
  const dayKey = (utc) => Math.floor(shifted(utc) / DAY);
  const weekKey = (utc) => Math.floor((dayKey(utc) + 3) / 7); // day 0 (1 Jan 1970) was a Thursday
  // Friday 17:00 NY → Sunday 17:00 NY.
  function isClosed(utc) {
    const dow = new Date(shifted(utc)).getUTCDay();
    return dow === 6 || dow === 0;
  }

  const SESSIONS = {
    all: { label: 'All sessions', hours: null },
    key: { label: 'Key CRT times (1, 5, 9 AM NY)', hours: [1, 5, 9] },
    london: { label: 'London (1 AM, 5 AM NY)', hours: [1, 5] },
    newyork: { label: 'New York (9 AM, 1 PM NY)', hours: [9, 13] },
    asia: { label: 'Asia (5 PM, 9 PM NY)', hours: [17, 21] },
  };
  const NAMES = { 17: 'Asia open', 21: 'Asia', 1: 'London open', 5: 'London / pre-NY', 9: 'New York AM', 13: 'New York PM' };
  const sessionName = (h) => NAMES[h] || `${h}:00 NY`;
  const fmtHour = (h) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'} NY`;

  /* Build NY-aligned 4H candles from 1H candles. Weekend hours are dropped so the
   * candles match a forex gold chart. A 4H candle is closed once its last hour is. */
  function build4h(hourly, now = Date.now()) {
    const out = [];
    let cur = null, curKey = null;
    for (const h of hourly) {
      if (isClosed(h.time)) continue;
      const s = shifted(h.time);
      const key = Math.floor(s / (4 * HOUR));
      if (key !== curKey) {
        if (cur) out.push(cur);
        const start = h.time - (s - key * 4 * HOUR);
        cur = { time: start, open: h.open, high: h.high, low: h.low, close: h.close, volume: h.volume || 0, nyHour: nyHour(start), closed: false };
        curKey = key;
      } else {
        cur.high = Math.max(cur.high, h.high);
        cur.low = Math.min(cur.low, h.low);
        cur.close = h.close;
        cur.volume += h.volume || 0;
      }
      cur.closed = h.closed !== false && cur.time + 4 * HOUR <= now;
    }
    if (cur) out.push(cur);
    return out;
  }

  const api = { HOUR, DAY, nyOffset, nyHour, dayKey, weekKey, isClosed, build4h, SESSIONS, sessionName, fmtHour };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sessions = api;
})(typeof window !== 'undefined' ? window : globalThis);
