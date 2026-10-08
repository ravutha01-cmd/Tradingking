#!/usr/bin/env node
/* Walk-forward selection of a ~5 signals/day XAUUSD rule set.
 *
 * For each year Y (2023 … 2026) the rule set is chosen using ONLY data before Y and
 * then traded during Y. Several selection methods are compared on the out-of-sample
 * years 2023–2025; the best method is chosen on those years alone, and its 2026 rule
 * set (selected on Aug 2020 – Dec 2025) is reported on 2026 as a final check and
 * used for the live Signals page.
 * Writes data/research/walkforward.json and js/intraday-data.js. */
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
function select(m, year) {
  const a = m.lookback === 'all' ? 0 : yStart(year - m.lookback), b = yStart(year);
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

// ---------- 1. Compare methods on out-of-sample 2023–2025 ----------
const end = frames[15].at(-1).time + 1;
log('\nWalk-forward (rules chosen on data before each year, traded in that year):');
const results = METHODS.map((m) => {
  const years = {};
  let oos = [];
  for (const y of YEARS) {
    const sel = select(m, y);
    const b = y === 2026 ? end : yStart(y + 1);
    const tr = trade(sel.legs, yStart(y), b);
    years[y] = { ...perf(tr, dayCount(yStart(y), b)), legs: sel.legs.length, selPerDay: sel.perDay };
    if (y < 2026) oos = oos.concat(tr);
  }
  const oosPerf = perf(oos.sort((x, y) => x.exitTime - y.exitTime), dayCount(yStart(2023), yStart(2026)));
  log(`  ${mName(m).padEnd(40)} 2023 ${years[2023].returnPct.toFixed(1)}% · 2024 ${years[2024].returnPct.toFixed(1)}% · 2025 ${years[2025].returnPct.toFixed(1)}% → 2023-25 ${oosPerf.returnPct.toFixed(1)}% DD ${oosPerf.maxDDPct.toFixed(1)}% ${oosPerf.perDay.toFixed(1)}/day`);
  return { m, name: mName(m), years, oos: oosPerf };
});

// Choose on 2023–2025 only: return ÷ drawdown, with 4–7 signals/day.
const eligible = results.filter((r) => r.oos.perDay >= 4 && r.oos.perDay <= 7 && r.oos.returnPct > 0);
eligible.sort((a, b) => b.oos.returnPct / Math.max(b.oos.maxDDPct, 1) - a.oos.returnPct / Math.max(a.oos.maxDDPct, 1));
const best = eligible[0];
if (!best) { log('No method kept 4–7 signals/day with a positive 2023–25 result.'); process.exit(1); }
log(`\nChosen on 2023–2025: ${best.name}`);
for (const y of YEARS) { const v = best.years[y]; log(`  ${y}${y === 2026 ? ' (final check)' : ''}: ${v.n} trades · ${v.perDay.toFixed(1)}/day · win ${(v.winRate * 100).toFixed(0)}% · avg ${v.avgR.toFixed(3)}R · ${v.returnPct.toFixed(1)}% · DD ${v.maxDDPct.toFixed(1)}% · months+ ${v.positiveMonths}/${v.months}`); }

// ---------- 2. The 2026 rule set (selected on Aug 2020 – Dec 2025) ----------
const sel26 = select(best.m, 2026);
const legs = sel26.legs.map(({ u, s }) => {
  const t26 = perf(inWin(u.trades, yStart(2026), end), dayCount(yStart(2026), end));
  log(`  2026 leg: ${u.tf}m ${u.id} ${JSON.stringify(u.p)} — selection ${s.avgR.toFixed(3)}R ${s.perDay.toFixed(2)}/day → 2026 ${t26.avgR.toFixed(3)}R ${t26.perDay.toFixed(2)}/day`);
  return {
    tf: u.tf, id: u.id, label: L.STRATS[u.id].label, params: u.p, rules: L.STRATS[u.id].describe(u.p),
    train: { n: s.n, perDay: s.perDay, avgR: s.avgR, winRate: null }, ytd: { n: t26.n, perDay: t26.perDay, avgR: t26.avgR, winRate: t26.winRate },
  };
});

// Cost sensitivity for the out-of-sample record (2023 → now).
const recordTrades = (cost) => {
  const all = [];
  for (const y of YEARS) {
    const b = y === 2026 ? end : yStart(y + 1);
    for (const { u } of select(best.m, y).legs) all.push(...L.backtest(frames[u.tf], L.STRATS[u.id], u.p, { cost }).filter((t) => t.entryTime >= yStart(y) && t.entryTime < b));
  }
  return all.sort((x, y) => x.exitTime - y.exitTime);
};
const costCurve = [0.2, 0.3, 0.4, 0.5, 0.6, 0.8].map((cost) => { const p = perf(recordTrades(cost), dayCount(yStart(2023), end)); return { cost, avgR: p.avgR, returnPct: p.returnPct }; });
log('  cost sensitivity 2023→now: ' + costCurve.map((c) => `$${c.cost}: ${c.returnPct.toFixed(1)}%`).join(' · '));

// Out-of-sample equity curve 2023 → now and the full record.
const record = recordTrades(COST);
let eq = 100;
const curve = record.map((t) => { eq *= 1 + (RISK / 100) * t.r; return [t.exitTime, +eq.toFixed(2)]; }).filter((_, i, a) => i % 3 === 0 || i === a.length - 1);
const recPerf = perf(record, dayCount(yStart(2023), end));
const ytd = best.years[2026];
log(`  Out-of-sample record 2023→now: ${recPerf.returnPct.toFixed(1)}% · DD ${recPerf.maxDDPct.toFixed(1)}% · ${recPerf.perDay.toFixed(1)}/day · months+ ${recPerf.positiveMonths}/${recPerf.months}`);

const out = {
  generatedAt: new Date().toISOString(), method: 'walk-forward', cost: COST, riskPct: RISK, targetPerDay: TARGET, testStart: yStart(2023),
  chosenMethod: best.name, methods: results.map((r) => ({ name: r.name, years: r.years, oos: r.oos })),
  years: best.years, record: recPerf, ytd, legs, costCurve, curve,
  universe: universe.length,
};
fs.writeFileSync(path.join(root, 'data/research/walkforward.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(root, 'js/intraday-data.js'), '/* Generated by scripts/research/walkforward.js */\nwindow.INTRADAY = ' + JSON.stringify(out) + ';\n');
log('\nWrote data/research/walkforward.json and js/intraday-data.js');
