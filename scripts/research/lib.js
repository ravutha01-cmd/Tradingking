/* Research toolkit: candle building, a bar-by-bar backtester and a set of classic
 * strategy families, used by scripts/research/run.js and (in the browser, as
 * window.Research) by research.html for live strategy signals. */
(function (root) {
'use strict';
const node = typeof module !== 'undefined' && module.exports;
const I = node ? require('../../js/indicators.js') : root.Indicators;
const S = node ? require('../../js/sessions.js') : root.Sessions;

const MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;

// ---------- Candles ----------
/* Build candles of `tfMin` minutes from 5m rows [t, o, h, l, c]. Weekend hours (gold
 * closed Fri 17:00 – Sun 17:00 NY) are dropped. Intraday frames ≤ 1H are UTC-aligned
 * (same as NY on whole hours); 4H and daily candles follow the NY trading day. */
function build(rows, tfMin) {
  const tf = tfMin * MIN;
  const out = [];
  let cur = null, curKey = null;
  for (const r of rows) {
    const t = r[0];
    if (S.isClosed(t)) continue;
    const shifted = tfMin <= 60 ? t : t + S.nyOffset(t) + 7 * HOUR;
    const key = Math.floor(shifted / tf);
    if (key !== curKey) {
      if (cur) out.push(cur);
      cur = { time: t - (shifted - key * tf), open: r[1], high: r[2], low: r[3], close: r[4] }; // time = candle start
      curKey = key;
    } else {
      if (r[2] > cur.high) cur.high = r[2];
      if (r[3] < cur.low) cur.low = r[3];
      cur.close = r[4];
    }
  }
  if (cur) out.push(cur);
  for (const c of out) { c.nyHour = S.nyHour(c.time); c.nyMin = new Date(c.time + S.nyOffset(c.time)).getUTCMinutes(); c.day = S.dayKey(c.time); }
  return out;
}

// ---------- Backtester ----------
/* One position at a time. A strategy decides at the close of bar i; orders fill at
 * the open of bar i+1. Stops/targets are checked intrabar (stop first if both are
 * touched); a gap through the stop fills at the open. `cost` is the round-trip cost
 * in price units (spread + slippage). Results are in R (multiples of initial risk). */
function backtest(c, strat, p, opts = {}) {
  const cost = opts.cost ?? 0.4;
  const from = opts.from ?? 0, to = opts.to ?? c.length - 1;
  const ctx = strat.prepare(c, p);
  const trades = [];
  let pos = null;
  const close = (i, price, why) => {
    const r = ((price - pos.entry) * pos.dir - cost) / pos.risk;
    trades.push({ dir: pos.dir, entryTime: c[pos.idx].time, exitTime: c[i].time, entry: pos.entry, exit: price, stop: pos.stop, target: pos.target, r, why, bars: i - pos.idx });
    pos = null;
  };
  for (let i = Math.max(from, 1); i <= to; i++) {
    const b = c[i];
    if (pos) {
      if (pos.exitNext) close(i, b.open, pos.exitNext);
      else if (pos.dir === 1 && b.open <= pos.stop) close(i, b.open, 'stop');
      else if (pos.dir === -1 && b.open >= pos.stop) close(i, b.open, 'stop');
      else if (pos.dir === 1 && b.low <= pos.stop) close(i, pos.stop, 'stop');
      else if (pos.dir === -1 && b.high >= pos.stop) close(i, pos.stop, 'stop');
      else if (pos.target != null && pos.dir === 1 && b.high >= pos.target) close(i, pos.target, 'target');
      else if (pos.target != null && pos.dir === -1 && b.low <= pos.target) close(i, pos.target, 'target');
      if (pos) {
        const why = strat.exit(ctx, i, pos);
        if (why) pos.exitNext = why;
        // Day trading: flat at the 4 PM NY close (exit at the open of the 16:00 candle).
        else if (p.eod && c[i + 1] && c[i + 1].nyHour === 16 && c[i].nyHour !== 16) pos.exitNext = 'eod';
        else if (p.maxBars && i - pos.idx + 1 >= p.maxBars) pos.exitNext = 'time';
        else if (strat.trail) {
          const s = strat.trail(ctx, i, pos);
          if (s != null) pos.stop = pos.dir === 1 ? Math.max(pos.stop, s) : Math.min(pos.stop, s);
        }
      }
    }
    if (!pos && i < to) {
      const sig = entrySignal(c, strat, p, ctx, i);
      if (sig) {
        const entry = c[i + 1].open;
        const risk = (entry - sig.stop) * sig.dir;
        // Skip trades whose stop is unrealistically tight (< minRiskPct of price, default 0.05% ≈ $2 at $4,000).
        if (risk >= entry * (opts.minRiskPct ?? 0.0005) && (sig.target == null || (sig.target - entry) * sig.dir > 0)) {
          pos = { dir: sig.dir, entry, stop: sig.stop, target: sig.target ?? null, risk, idx: i + 1 };
        }
      }
    }
  }
  if (pos) close(to, c[to].close, 'end');
  return trades;
}

/* Entry signal at the close of bar i, after the optional gates: session (London + New
 * York, 2 AM – noon NY), no new day trades in the last hour before the 4 PM NY close,
 * and the higher-timeframe trend direction (c.htf[name][i]). */
function entrySignal(c, strat, p, ctx, i) {
  const h = c[i].nyHour;
  if ((p.sess === 'ldnny' && !(h >= 2 && h < 12)) || (p.eod && h === 15)) return null;
  const sig = strat.entry(ctx, i);
  if (sig && p.htf && p.htf !== 'none' && (!c.htf || c.htf[p.htf][i] !== sig.dir)) return null;
  return sig;
}

function stats(trades, years) {
  const n = trades.length;
  let tot = 0, gp = 0, gl = 0, wins = 0, peak = 0, dd = 0, eq = 1, eqPeak = 1, ddPct = 0;
  for (const t of trades) {
    tot += t.r;
    if (t.r > 0) { gp += t.r; wins++; } else gl -= t.r;
    peak = Math.max(peak, tot); dd = Math.max(dd, peak - tot);
    eq *= 1 + 0.01 * t.r; eqPeak = Math.max(eqPeak, eq); ddPct = Math.max(ddPct, 1 - eq / eqPeak);
  }
  const avg = n ? tot / n : 0;
  const sd = n > 1 ? Math.sqrt(trades.reduce((a, t) => a + (t.r - avg) ** 2, 0) / (n - 1)) : 0;
  return {
    trades, n, winRate: n ? wins / n : 0, avgR: avg, totalR: tot, pf: gl ? gp / gl : gp > 0 ? 99 : 0, maxDDR: dd,
    // Account view: risking 1% of equity per trade, compounded.
    returnPct: (eq - 1) * 100, maxDDPct: ddPct * 100, perYear: years ? n / years : null,
    sharpe: sd ? (avg / sd) * Math.sqrt(years ? n / years : n) : 0,
  };
}

// ---------- Strategy families ----------
const cache = new Map();
function memo(c, key, fn) {
  let m = cache.get(c);
  if (!m) { m = new Map(); cache.set(c, m); }
  if (!m.has(key)) m.set(key, fn());
  return m.get(key);
}
const closes = (c) => memo(c, 'close', () => c.map((x) => x.close));
const ema = (c, n) => memo(c, 'ema' + n, () => I.ema(closes(c), n));
const atr = (c) => memo(c, 'atr', () => I.atr(c, 14));
const rsi = (c, n) => memo(c, 'rsi' + n, () => I.rsi(closes(c), n));
const bb = (c, n) => memo(c, 'bb' + n, () => I.bollinger(closes(c), n, 2));
function rolling(c, n, key, fn) {
  return memo(c, key + n, () => {
    const out = new Array(c.length).fill(null);
    for (let i = n; i < c.length; i++) { let v = c[i - n][key]; for (let j = i - n + 1; j < i; j++) v = fn(v, c[j][key]); out[i] = v; }
    return out;
  });
}

const STRATS = {
  // Trend: EMA crossover, ATR stop, chandelier trail, exit on opposite cross.
  ema: {
    label: 'EMA crossover trend',
    describe: (p) => `Buy when EMA${p.fast} crosses above EMA${p.slow}${p.longOnly ? '' : ' (sell on the opposite cross)'}; stop ${p.atr}× ATR, trailed at ${p.atr}× ATR from the best close; exit on the opposite cross.`,
    grid: { fast: [10, 20, 50], slow: [50, 100, 200], atr: [2, 3, 4], longOnly: [true, false] },
    valid: (p) => p.fast < p.slow,
    prepare: (c, p) => ({ c, f: ema(c, p.fast), s: ema(c, p.slow), a: atr(c), p }),
    entry: ({ c, f, s, a, p }, i) => {
      if (f[i - 1] == null || s[i - 1] == null || a[i] == null) return null;
      if (f[i - 1] <= s[i - 1] && f[i] > s[i]) return { dir: 1, stop: c[i].close - p.atr * a[i] };
      if (!p.longOnly && f[i - 1] >= s[i - 1] && f[i] < s[i]) return { dir: -1, stop: c[i].close + p.atr * a[i] };
      return null;
    },
    exit: ({ f, s }, i, pos) => ((pos.dir === 1 ? f[i] < s[i] : f[i] > s[i]) ? 'signal' : null),
    trail: ({ c, a, p }, i, pos) => {
      pos.best = pos.dir === 1 ? Math.max(pos.best ?? -Infinity, c[i].close) : Math.min(pos.best ?? Infinity, c[i].close);
      return pos.best - pos.dir * p.atr * a[i];
    },
  },
  // Breakout: Donchian channel (Turtle-style).
  donchian: {
    label: 'Donchian breakout',
    describe: (p) => `Buy a close above the ${p.n}-bar high${p.longOnly ? '' : ' (sell a close below the ' + p.n + '-bar low)'}; exit on a close beyond the ${p.m}-bar opposite channel; stop ${p.atr}× ATR.`,
    grid: { n: [20, 55, 100], m: [10, 20, 50], atr: [2, 3], longOnly: [true, false] },
    valid: (p) => p.m < p.n,
    prepare: (c, p) => ({ c, hi: rolling(c, p.n, 'high', Math.max), lo: rolling(c, p.n, 'low', Math.min), xhi: rolling(c, p.m, 'high', Math.max), xlo: rolling(c, p.m, 'low', Math.min), a: atr(c), p }),
    entry: ({ c, hi, lo, a, p }, i) => {
      if (hi[i] == null || a[i] == null) return null;
      if (c[i].close > hi[i]) return { dir: 1, stop: c[i].close - p.atr * a[i] };
      if (!p.longOnly && c[i].close < lo[i]) return { dir: -1, stop: c[i].close + p.atr * a[i] };
      return null;
    },
    exit: ({ c, xhi, xlo }, i, pos) => ((pos.dir === 1 ? c[i].close < xlo[i] : c[i].close > xhi[i]) ? 'signal' : null),
  },
  // Pullback in trend: short-term RSI dip while above the long EMA.
  pullback: {
    label: 'Trend pullback (RSI)',
    describe: (p) => `When price is above EMA${p.trend}, buy when RSI(${p.len}) drops below ${p.lo}${p.longOnly ? '' : ' (mirror for shorts below the EMA)'}; exit when RSI(${p.len}) rises above ${p.exit} or after ${p.maxBars} bars; stop ${p.atr}× ATR.`,
    grid: { len: [2, 14], lo: [10, 30], exit: [50, 70], trend: [50, 200], atr: [1.5, 3], maxBars: [10, 30], longOnly: [true, false] },
    valid: (p) => !(p.len === 14 && p.lo === 10),
    prepare: (c, p) => ({ c, r: rsi(c, p.len), e: ema(c, p.trend), a: atr(c), p }),
    entry: ({ c, r, e, a, p }, i) => {
      if (r[i] == null || e[i] == null || a[i] == null) return null;
      if (c[i].close > e[i] && r[i] < p.lo) return { dir: 1, stop: c[i].close - p.atr * a[i] };
      if (!p.longOnly && c[i].close < e[i] && r[i] > 100 - p.lo) return { dir: -1, stop: c[i].close + p.atr * a[i] };
      return null;
    },
    exit: ({ r, p }, i, pos) => ((pos.dir === 1 ? r[i] > p.exit : r[i] < 100 - p.exit) ? 'signal' : null),
  },
  // Mean reversion: Bollinger band extremes back to the middle.
  bbrev: {
    label: 'Bollinger mean reversion',
    describe: (p) => `Buy a close below the lower Bollinger band (${p.n}, 2σ)${p.longOnly ? '' : ', sell a close above the upper band'}; take profit at the middle band; stop ${p.atr}× ATR; max ${p.maxBars} bars.`,
    grid: { n: [20, 50], atr: [1, 2, 3], maxBars: [10, 30], longOnly: [true, false] },
    prepare: (c, p) => ({ c, b: bb(c, p.n), a: atr(c), p }),
    entry: ({ c, b, a, p }, i) => {
      if (b.lower[i] == null || a[i] == null) return null;
      if (c[i].close < b.lower[i]) return { dir: 1, stop: c[i].close - p.atr * a[i], target: b.mid[i] };
      if (!p.longOnly && c[i].close > b.upper[i]) return { dir: -1, stop: c[i].close + p.atr * a[i], target: b.mid[i] };
      return null;
    },
    exit: () => null,
  },
  // Session breakout: Asia range (20:00–00:00 NY), trade the first break 02:00–11:00 NY, flat by 16:00 NY.
  orb: {
    label: 'Asia range breakout',
    intradayOnly: true,
    describe: (p) => `Mark the Asia range (8 PM – midnight NY). From 2 AM to 11 AM NY, buy the first close above it${p.longOnly ? '' : ' or sell the first close below it'}; stop at the ${p.stop === 'mid' ? 'middle' : 'other side'} of the range; target ${p.tp}× the range; close by 4 PM NY.`,
    grid: { stop: ['mid', 'other'], tp: [1, 2, 3], minRangeAtr: [0, 0.5], longOnly: [true, false] },
    prepare: (c, p) => {
      const a = atr(c);
      const rh = new Array(c.length).fill(null), rl = new Array(c.length).fill(null), traded = new Set();
      let day = null, hi = -Infinity, lo = Infinity, done = null;
      for (let i = 0; i < c.length; i++) {
        const h = c[i].nyHour;
        if (c[i].day !== day) { day = c[i].day; hi = -Infinity; lo = Infinity; done = null; }
        if (h >= 20) { hi = Math.max(hi, c[i].high); lo = Math.min(lo, c[i].low); }
        else if (done == null && hi > -Infinity) done = [hi, lo];
        if (done) { rh[i] = done[0]; rl[i] = done[1]; }
      }
      return { c, rh, rl, a, p, traded };
    },
    entry: ({ c, rh, rl, a, p, traded }, i) => {
      const h = c[i].nyHour;
      if (rh[i] == null || h < 2 || h >= 11 || traded.has(c[i].day)) return null;
      const range = rh[i] - rl[i];
      if (range <= 0 || (a[i] != null && range < p.minRangeAtr * a[i])) return null;
      const mid = (rh[i] + rl[i]) / 2;
      if (c[i].close > rh[i]) { traded.add(c[i].day); return { dir: 1, stop: p.stop === 'mid' ? mid : rl[i], target: c[i].close + p.tp * range }; }
      if (c[i].close < rl[i]) { traded.add(c[i].day); if (p.longOnly) return null; return { dir: -1, stop: p.stop === 'mid' ? mid : rh[i], target: c[i].close - p.tp * range }; }
      return null;
    },
    exit: ({ c }, i) => (c[i].nyHour >= 16 && c[i].nyHour < 17 ? 'session end' : null),
  },
};

function combos(grid, valid) {
  let out = [{}];
  for (const [k, vals] of Object.entries(grid)) out = out.flatMap((o) => vals.map((v) => ({ ...o, [k]: v })));
  return valid ? out.filter(valid) : out;
}

/* Higher-timeframe trend for each lower-timeframe candle, using only HTF candles that
 * have closed by the end of that candle: 1 when close > EMA50 > EMA200, -1 when
 * close < EMA50 < EMA200, else 0. */
function htfTrend(c, tfMin, h, htfMin) {
  const cl = h.map((x) => x.close);
  const e50 = I.ema(cl, 50), e200 = I.ema(cl, 200);
  const dir = h.map((x, k) => (e200[k] == null ? 0 : x.close > e50[k] && e50[k] > e200[k] ? 1 : x.close < e50[k] && e50[k] < e200[k] ? -1 : 0));
  const out = new Int8Array(c.length);
  let k = -1;
  for (let i = 0; i < c.length; i++) {
    const end = c[i].time + tfMin * MIN;
    while (k + 1 < h.length && h[k + 1].time + htfMin * MIN <= end) k++;
    out[i] = k >= 0 ? dir[k] : 0;
  }
  return out;
}

const api = { MIN, HOUR, DAY, build, backtest, entrySignal, stats, STRATS, combos, htfTrend };
if (node) module.exports = api;
else root.Research = api;
})(typeof window !== 'undefined' ? window : globalThis);
