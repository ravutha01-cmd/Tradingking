#!/usr/bin/env node
/* "5 signals a day" research: find a set of XAUUSD rules on 15m–4H charts that
 * together give about 5 signals per day, chosen on 2020–2024 and checked on 2025–2026.
 * Needs data/cache/paxg-5m.json. Writes data/research/intraday.json (a single train/test split;
 * the live rule set comes from walkforward.js). */
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

const TEST_START = Date.UTC(2025, 0, 1), Y2026 = Date.UTC(2026, 0, 1);
const COST = 0.4;
const TARGET_PER_DAY = 5;
const RISK = 0.25; // % of account risked per trade in the day-trading portfolio
const log = (...a) => console.log(...a);
const firstIdx = (c, t) => { const i = c.findIndex((x) => x.time >= t); return i < 0 ? c.length : i; };
const daysIn = (c, a, b) => { const s = new Set(); for (let i = a; i <= b; i++) s.add(c[i].day); return s.size; };
const TFS = [15, 30, 60, 240];

// Grids: both directions, optional higher-timeframe trend filter, session filter, and
// either day trades (closed by 4 PM New York) or trades that may run overnight.
const GRIDS = {
  pullback: { len: [2], lo: [10, 25], exit: [50, 70], trend: [50, 200], atr: [1.5, 3], maxBars: [12, 48] },
  donchian: { n: [20, 55], m: [10, 20], atr: [2, 3] },
  ema: { fast: [10, 20], slow: [50, 100], atr: [2, 3] },
  bbrev: { n: [20], atr: [1.5, 3], maxBars: [12, 36] },
  orb: { stop: ['mid', 'other'], tp: [1, 2], minRangeAtr: [0, 0.5] },
};
const FILTERS = { htf: ['none', 'h1', 'h4'], sess: ['all', 'ldnny'], eod: [true, false] };

const frames = {};
const h1 = L.build(rows, 60), h4 = L.build(rows, 240);
for (const tf of TFS) {
  const c = tf === 60 ? L.build(rows, 60) : tf === 240 ? L.build(rows, 240) : L.build(rows, tf);
  c.htf = { h1: L.htfTrend(c, tf, h1, 60), h4: L.htfTrend(c, tf, h4, 240) };
  const cut = firstIdx(c, TEST_START), y26 = firstIdx(c, Y2026);
  frames[tf] = { c, cut, y26, trainDays: daysIn(c, 0, cut - 1), testDays: daysIn(c, cut, c.length - 1), y26Days: daysIn(c, y26, c.length - 1) };
  log(`${tf}m: ${c.length} candles · train ${frames[tf].trainDays} days · test ${frames[tf].testDays} days`);
}

// ---------- 1. Search every rule on training data ----------
const cands = [];
for (const tf of TFS) {
  const { c, cut, trainDays } = frames[tf];
  for (const [id, grid] of Object.entries(GRIDS)) {
    const st = L.STRATS[id];
    if (id === 'orb' && tf > 60) continue;
    const g = { ...grid, longOnly: [false], ...FILTERS };
    if (tf === 240) g.htf = ['none']; // the 4H trend filter is the chart itself
    if (tf === 60) g.htf = ['none', 'h4'];
    if (id === 'orb') { g.sess = ['all']; g.eod = [true]; } // has its own trading window
    for (const p of L.combos(g, st.valid)) {
      const trades = L.backtest(c, st, p, { cost: COST, from: 0, to: cut - 1 });
      if (trades.length < 40) continue;
      const q = Math.floor(trades.length / 4);
      const foldAvg = [0, 1, 2, 3].map((f) => { const s = trades.slice(f * q, f === 3 ? trades.length : (f + 1) * q); return s.reduce((a, t) => a + t.r, 0) / s.length; });
      const s = L.stats(trades);
      cands.push({ tf, id, p, n: s.n, perDay: s.n / trainDays, avgR: s.avgR, winRate: s.winRate, foldsPositive: foldAvg.filter((v) => v > 0).length, foldAvg, ret: s.returnPct, dd: s.maxDDPct });
    }
  }
  log(`searched ${tf}m: ${cands.length} rule settings so far`);
}
// Same bar as the main study: profitable in ≥3 of 4 training slices, a margin over costs,
// and a training drawdown of at most 25% at 1% risk per trade.
const good = cands.filter((x) => x.foldsPositive >= 3 && x.avgR > 0.02 && x.dd <= 25 && x.ret > 0).sort((a, b) => b.ret / Math.max(b.dd, 1) - a.ret / Math.max(a.dd, 1));
log(`\n${good.length} of ${cands.length} rule settings were profitable in ≥3 of 4 training slices (avg > 0.02R).`);
for (const x of good.slice(0, 25)) log(`  ${x.tf}m ${x.id.padEnd(8)} ${JSON.stringify(x.p)} ${x.perDay.toFixed(2)}/day avg ${x.avgR.toFixed(3)}R win ${(x.winRate * 100).toFixed(0)}% ret ${x.ret.toFixed(0)}% DD ${x.dd.toFixed(0)}%`);

// ---------- 2. Build the ~5/day portfolio (training data only) ----------
// Take the best-ranked rule of each (timeframe, family) pair, in ranking order, until
// the combined training frequency reaches ~5 signals per day.
const legs = [], used = new Set();
let perDay = 0;
for (const x of good) {
  const key = x.tf + x.id;
  if (used.has(key)) continue;
  legs.push(x); used.add(key); perDay += x.perDay;
  if (perDay >= TARGET_PER_DAY || legs.length >= 8) break;
}
log(`\nPortfolio: ${legs.length} rules, ${perDay.toFixed(2)} signals/day in training`);

function portfolio(a, b, label) {
  const all = [];
  for (const x of legs) {
    const fr = frames[x.tf];
    for (const t of L.backtest(fr.c, L.STRATS[x.id], x.p, { cost: COST, from: firstIdx(fr.c, a), to: b === Infinity ? fr.c.length - 1 : firstIdx(fr.c, b) - 1 })) all.push({ ...t, leg: `${x.tf}m ${L.STRATS[x.id].label}` });
  }
  all.sort((p, q) => p.exitTime - q.exitTime);
  let eq = 1, peak = 1, dd = 0, wins = 0;
  const days = new Map();
  const curve = [];
  for (const t of all) {
    eq *= 1 + (RISK / 100) * t.r; peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak);
    if (t.r > 0) wins++;
    const d = S.dayKey(t.entryTime);
    days.set(d, (days.get(d) || 0) + 1);
    curve.push([t.exitTime, +(eq * 100).toFixed(2)]);
  }
  const fr = frames[15];
  const nDays = label === 'train' ? fr.trainDays : label === 'test' ? fr.testDays : fr.y26Days;
  const counts = [...days.values()];
  const avgR = all.reduce((s, t) => s + t.r, 0) / (all.length || 1);
  // Monthly returns
  const months = new Map();
  for (const t of all) { const m = new Date(t.exitTime).toISOString().slice(0, 7); months.set(m, (months.get(m) || 0) + (RISK / 100) * t.r * 100); }
  return {
    n: all.length, perDay: all.length / nDays, activeDays: days.size / nDays, maxPerDay: Math.max(0, ...counts),
    winRate: wins / (all.length || 1), avgR, returnPct: (eq - 1) * 100, maxDDPct: dd * 100,
    positiveMonths: [...months.values()].filter((v) => v > 0).length, months: months.size, monthly: [...months.entries()],
    curve, recent: all.slice(-25).map((t) => ({ leg: t.leg, dir: t.dir, entryTime: t.entryTime, exitTime: t.exitTime, entry: t.entry, exit: t.exit, stop: t.stop, r: +t.r.toFixed(2), why: t.why })),
  };
}
const res = { train: portfolio(0, TEST_START, 'train'), test: portfolio(TEST_START, Infinity, 'test'), ytd: portfolio(Y2026, Infinity, 'ytd') };

// Cost sensitivity on the test period: what if your spread + commission is higher or lower?
const costCurve = [0.2, 0.3, 0.4, 0.5, 0.6, 0.8].map((cost) => {
  let eq = 1, n = 0, sum = 0;
  const all = [];
  for (const x of legs) { const fr = frames[x.tf]; all.push(...L.backtest(fr.c, L.STRATS[x.id], x.p, { cost, from: fr.cut, to: fr.c.length - 1 })); }
  all.sort((p, q) => p.exitTime - q.exitTime);
  for (const t of all) { eq *= 1 + (RISK / 100) * t.r; n++; sum += t.r; }
  return { cost, avgR: sum / n, returnPct: (eq - 1) * 100 };
});
log('  cost sensitivity (2025–26): ' + costCurve.map((x) => `$${x.cost}: ${x.returnPct.toFixed(1)}%`).join(' · '));
for (const [k, v] of Object.entries(res)) log(`  ${k.padEnd(5)} ${v.n} trades · ${v.perDay.toFixed(2)}/day · signals on ${(v.activeDays * 100).toFixed(0)}% of days · win ${(v.winRate * 100).toFixed(0)}% · avg ${v.avgR.toFixed(3)}R · return ${v.returnPct.toFixed(1)}% · maxDD ${v.maxDDPct.toFixed(1)}% · months + ${v.positiveMonths}/${v.months}`);

// Each leg on its own, on the test period.
const legInfo = legs.map((x) => {
  const fr = frames[x.tf];
  const t = L.stats(L.backtest(fr.c, L.STRATS[x.id], x.p, { cost: COST, from: fr.cut, to: fr.c.length - 1 }));
  const y = L.stats(L.backtest(fr.c, L.STRATS[x.id], x.p, { cost: COST, from: fr.y26, to: fr.c.length - 1 }));
  log(`  leg ${x.tf}m ${x.id} train ${x.avgR.toFixed(3)}R ${x.perDay.toFixed(2)}/day → test ${t.avgR.toFixed(3)}R ${(t.n / fr.testDays).toFixed(2)}/day · 2026 ${y.avgR.toFixed(3)}R`);
  return { tf: x.tf, id: x.id, label: L.STRATS[x.id].label, params: x.p, rules: L.STRATS[x.id].describe(x.p), train: { n: x.n, perDay: x.perDay, avgR: x.avgR, winRate: x.winRate }, test: { n: t.n, perDay: t.n / fr.testDays, avgR: t.avgR, winRate: t.winRate }, ytd: { n: y.n, avgR: y.avgR, winRate: y.winRate } };
});

const out = {
  generatedAt: new Date().toISOString(), cost: COST, riskPct: RISK, targetPerDay: TARGET_PER_DAY, testStart: TEST_START,
  searched: cands.length, passed: good.length, legs: legInfo, costCurve,
  train: { ...res.train, curve: undefined }, test: { ...res.test, curve: undefined }, ytd: { ...res.ytd, curve: undefined },
  curve: res.train.curve.concat(res.test.curve.map(([t, v]) => [t, +(v * res.train.curve.at(-1)[1] / 100).toFixed(2)])).filter((_, i, a) => i % 3 === 0 || i === a.length - 1),
  topCandidates: good.slice(0, 20).map((x) => ({ tf: x.tf, id: x.id, p: x.p, perDay: x.perDay, avgR: x.avgR, ret: x.ret, dd: x.dd })),
};
fs.writeFileSync(path.join(root, 'data/research/intraday.json'), JSON.stringify(out, null, 1));
log('\nWrote data/research/intraday.json (the live Signals page uses scripts/research/walkforward.js)');
