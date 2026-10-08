/* Shared walk-forward machinery for walkforward.js and adaptive.js: candles, the
 * 1,864-rule universe (each backtested once over the whole history), rule-set
 * selection from data before a cut-off date, and performance statistics. */
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');
const S = require('../../js/sessions.js');

const root = path.join(__dirname, '../..');
const rows = JSON.parse(fs.readFileSync(path.join(root, 'data/cache/paxg-5m.json'), 'utf8'));
for (let i = 1; i < rows.length - 1; i++) { // flatten single-candle spikes (see run.js)
  const p = rows[i - 1][4], c = rows[i][4], n = rows[i + 1][4];
  if (Math.abs(c / p - 1) > 0.025 && Math.abs(n / c - 1) > 0.025 && Math.sign(c - p) !== Math.sign(n - c)) rows[i] = [rows[i][0], p, Math.max(p, n), Math.min(p, n), p];
}
const log = (...a) => console.log(...a);
const COST = 0.4, RISK = 0.25, TARGET = 5;
const YEARS = [2023, 2024, 2025, 2026];
const yStart = (y) => Date.UTC(y, 0, 1);
const firstIdx = (c, t) => { let lo = 0, hi = c.length; while (lo < hi) { const m = (lo + hi) >> 1; if (c[m].time < t) lo = m + 1; else hi = m; } return lo; };

// ---------- Candles & rule universe (same as intraday.js) ----------
const TFS = [15, 30, 60, 240];
const h1 = L.build(rows, 60), h4 = L.build(rows, 240);
const frames = {};
for (const tf of TFS) {
  const c = tf === 60 ? h1 : tf === 240 ? h4 : L.build(rows, tf);
  c.htf = { h1: L.htfTrend(c, tf, h1, 60), h4: L.htfTrend(c, tf, h4, 240) };
  frames[tf] = c;
}
const dayCount = (a, b) => { const s = new Set(); const c = frames[15]; for (let i = firstIdx(c, a); i < c.length && c[i].time < b; i++) s.add(c[i].day); return s.size; };

const GRIDS = {
  pullback: { len: [2], lo: [10, 25], exit: [50, 70], trend: [50, 200], atr: [1.5, 3], maxBars: [12, 48] },
  donchian: { n: [20, 55], m: [10, 20], atr: [2, 3] },
  ema: { fast: [10, 20], slow: [50, 100], atr: [2, 3] },
  bbrev: { n: [20], atr: [1.5, 3], maxBars: [12, 36] },
  orb: { stop: ['mid', 'other'], tp: [1, 2], minRangeAtr: [0, 0.5] },
};
const universe = [];
for (const tf of TFS) {
  for (const [id, grid] of Object.entries(GRIDS)) {
    if (id === 'orb' && tf > 60) continue;
    const g = { ...grid, longOnly: [false], htf: ['none', 'h1', 'h4'], sess: ['all', 'ldnny'], eod: [true, false] };
    if (tf === 240) g.htf = ['none'];
    if (tf === 60) g.htf = ['none', 'h4'];
    if (id === 'orb') { g.sess = ['all']; g.eod = [true]; }
    for (const p of L.combos(g, L.STRATS[id].valid)) universe.push({ tf, id, p });
  }
}
// Every rule's full trade list, computed once; windows are slices by entry time.
log(`Backtesting ${universe.length} rule settings over the whole history…`);
for (const u of universe) u.trades = L.backtest(frames[u.tf], L.STRATS[u.id], u.p, { cost: COST });
const inWin = (trades, a, b) => trades.filter((t) => t.entryTime >= a && t.entryTime < b);

function windowStats(trades, days) {
  const n = trades.length;
  if (n < 40) return null;
  const q = Math.floor(n / 4);
  const foldAvg = [0, 1, 2, 3].map((f) => { const s = trades.slice(f * q, f === 3 ? n : (f + 1) * q); return s.reduce((a, t) => a + t.r, 0) / s.length; });
  const s = L.stats(trades);
  return { n, perDay: n / days, avgR: s.avgR, ret: s.returnPct, dd: s.maxDDPct, foldsPositive: foldAvg.filter((v) => v > 0).length };
}

/* A selection method = how to rank rules on the selection window.
 *   rank:     'retdd' (return ÷ drawdown) or 'edge' (average R per trade)
 *   lookback: 'all' (since Aug 2020) or 2 (the last two years only)
 *   minEdge:  minimum average R per trade after costs */
const METHODS = [];
for (const rank of ['retdd', 'edge']) for (const lookback of ['all', 2]) for (const minEdge of [0.02, 0.05]) METHODS.push({ rank, lookback, minEdge });
const mName = (m) => `${m.rank === 'retdd' ? 'return÷DD' : 'edge/trade'} · ${m.lookback === 'all' ? 'all history' : 'last 2 yrs'} · min ${m.minEdge}R`;

const selCache = new Map();
// Choose the rule set with data before `cutoff` (a timestamp); lookback 'all' or N years.
function select(m, cutoff) {
  const a = m.lookback === 'all' ? 0 : cutoff - m.lookback * 365.25 * 86400e3, b = cutoff;
  const key = `${a}-${b}`;
  if (!selCache.has(key)) {
    const days = dayCount(a, b);
    selCache.set(key, universe.map((u) => ({ u, s: windowStats(inWin(u.trades, a, b), days) })).filter((x) => x.s));
  }
  const pool = selCache.get(key).filter(({ s }) => s.foldsPositive >= 3 && s.avgR > m.minEdge && s.dd <= 25 && s.ret > 0);
  pool.sort((x, y) => (m.rank === 'edge' ? y.s.avgR - x.s.avgR : y.s.ret / Math.max(y.s.dd, 1) - x.s.ret / Math.max(x.s.dd, 1)));
  const legs = [], used = new Set();
  let perDay = 0;
  for (const x of pool) {
    const k = x.u.tf + x.u.id;
    if (used.has(k)) continue;
    legs.push(x); used.add(k); perDay += x.s.perDay;
    if (perDay >= TARGET || legs.length >= 10) break;
  }
  return { legs, perDay, pool: pool.length };
}

function trade(legs, a, b) {
  const all = [];
  for (const { u } of legs) for (const t of inWin(u.trades, a, b)) all.push({ ...t, leg: u });
  all.sort((x, y) => x.exitTime - y.exitTime);
  return all;
}
function perf(all, days) {
  let eq = 1, peak = 1, dd = 0, wins = 0, sum = 0;
  const months = new Map();
  for (const t of all) {
    eq *= 1 + (RISK / 100) * t.r; peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak);
    if (t.r > 0) wins++; sum += t.r;
    const k = new Date(t.exitTime).toISOString().slice(0, 7);
    months.set(k, (months.get(k) || 0) + t.r);
  }
  return { n: all.length, perDay: all.length / days, winRate: wins / (all.length || 1), avgR: sum / (all.length || 1), returnPct: (eq - 1) * 100, maxDDPct: dd * 100, positiveMonths: [...months.values()].filter((v) => v > 0).length, months: months.size };
}

const end = frames[15].at(-1).time + 1;

module.exports = { L, S, root, rows, frames, universe, inWin, windowStats, METHODS, mName, select, trade, perf, dayCount, firstIdx, yStart, log, COST, RISK, TARGET, end };
