#!/usr/bin/env node
/* Candidate improvements to the LIVE adaptive monthly 5-a-day system (scripts/research/adaptive.js).
 * Read-only w.r.t. existing code/data: requires wf-core.js / lib.js / news.js, writes nothing.
 *
 * Adoption rule (stated before running): a variant is adopted only if its out-of-sample
 * 2023-01-01..2025-12-31 return/maxDD (0.25% risk/trade, $0.40 cost) is >= 1.10x the baseline's
 * AND its 2023-25 signals/day stays within 4.5-7. 2026 is reported as a check only.
 * If several pass, their combination is tested (on 2023-25 first).
 *
 * Procedure per variant (identical to adaptive.js "monthly · adaptive"):
 *   for each of the 8 selection methods, rules are re-chosen on the 1st of every month from data
 *   before that date (wf-core select); the method's out-of-sample stream = those rules' trades
 *   entered during the month. The variant's transform (filter / cap / sizing) is applied to every
 *   method's stream, the adaptive pick (best trailing-12-month OOS return/DD among methods with
 *   >= 4.5/day) is made on the transformed streams, and the transform is re-applied to the final
 *   combined stream (needed for the concurrency cap across month boundaries).
 *
 * Run: node --max-old-space-size=8000 scripts/research/experiments/improvements.js [--combo=a,b] [--costs]
 */
const path = require('path');
const W = require('../wf-core.js');
const I = require('../../../js/indicators.js');
const { eventTime } = require('../news.js');
const { L, root, universe, METHODS, select, windowStats, dayCount, yStart, end, RISK, COST } = W;
const events = require(path.join(root, 'data/events/us-macro-events.json')).events;

const argv = process.argv.slice(2);
const arg = (k) => { const a = argv.find((x) => x.startsWith('--' + k)); return a ? (a.includes('=') ? a.split('=')[1] : true) : null; };
const Y23 = yStart(2023), Y26 = yStart(2026), DAYMS = 86400e3, HOURMS = 3600e3, MIN_PER_DAY = 4.5;
const ratio = (p) => (p.maxDDPct > 0 ? p.returnPct / p.maxDDPct : p.returnPct > 0 ? 99 : 0);
universe.forEach((u, k) => { u.k = k; });

// Monthly periods (same as adaptive.js)
const P = [];
for (let y = 2023; y <= 2026; y++) for (let i = 0; i < 12; i++) { const a = Date.UTC(y, i, 1); if (a < end) P.push(a); }
const PERIODS = P.map((a, k) => [a, k + 1 < P.length ? P[k + 1] : end]);

// ---------- Filters ----------
// 1. News blackout: no entries in [T - X, T + X] around CPI/PPI/NFP/FOMC.
const evT = events.filter((e) => ['CPI', 'PPI', 'NFP', 'FOMC'].includes(e.type)).map((e) => eventTime(e.date, e.timeNY)).sort((a, b) => a - b);
function newsFilter(mins) {
  const X = mins * 60e3;
  return (t) => {
    let lo = 0, hi = evT.length; // first event >= entryTime - X
    while (lo < hi) { const m = (lo + hi) >> 1; if (evT[m] < t.entryTime - X) lo = m + 1; else hi = m; }
    return !(lo < evT.length && evT[lo] <= t.entryTime + X);
  };
}
// 3. Volatility regime: 1H ATR(14) percentile vs trailing 60 days, from the last 1H candle CLOSED by entry time.
const h1 = W.frames[60];
const a1 = I.atr(h1, 14);
const volPct = new Float64Array(h1.length).fill(NaN);
{
  let j0 = 0;
  for (let k = 0; k < h1.length; k++) {
    if (a1[k] == null) continue;
    while (h1[j0].time < h1[k].time - 60 * DAYMS) j0++;
    let n = 0, below = 0;
    for (let j = j0; j < k; j++) if (a1[j] != null) { n++; if (a1[j] < a1[k]) below++; }
    if (n >= 500) volPct[k] = below / n;
  }
}
function volAt(t) { // last h1 bar with time + 1h <= t
  let lo = 0, hi = h1.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (h1[m].time + HOURMS <= t) lo = m + 1; else hi = m; }
  return lo > 0 ? volPct[lo - 1] : NaN;
}
const volFilter = (lo, hi) => (t) => { const v = volAt(t.entryTime); return !(v > hi || v < lo); };

// ---------- Selection (optionally on filtered rule trades) ----------
const selCache = new Map();
function selectWith(m, cutoff, sel) {
  if (!sel) return select(m, cutoff);
  const a = m.lookback === 'all' ? 0 : cutoff - m.lookback * 365.25 * DAYMS, b = cutoff;
  const key = `${sel.tag}|${a}-${b}`;
  if (!selCache.has(key)) {
    const days = dayCount(a, b);
    selCache.set(key, universe.map((u) => ({ u, s: windowStats(u.trades.filter((t) => t.entryTime >= a && t.entryTime < b && sel.f(t)), days) })).filter((x) => x.s));
  }
  const pool = selCache.get(key).filter(({ s }) => s.foldsPositive >= 3 && s.avgR > m.minEdge && s.dd <= 25 && s.ret > 0);
  pool.sort((x, y) => (m.rank === 'edge' ? y.s.avgR - x.s.avgR : y.s.ret / Math.max(y.s.dd, 1) - x.s.ret / Math.max(x.s.dd, 1)));
  const legs = [], used = new Set(); let perDay = 0;
  for (const x of pool) { const k = x.u.tf + x.u.id; if (used.has(k)) continue; legs.push(x); used.add(k); perDay += x.s.perDay; if (perDay >= W.TARGET || legs.length >= 10) break; }
  return { legs, perDay, pool: pool.length };
}

// ---------- 4. Risk weights by selection-window edge (cap 2x, frequency-weighted mean 1) ----------
function edgeWeights(legs) {
  const f = legs.map((l) => l.s.perDay), e = legs.map((l) => Math.max(l.s.avgR, 1e-6));
  let w = e.slice(), capped = new Array(legs.length).fill(false);
  for (let it = 0; it < 20; it++) {
    const F = f.reduce((a, b) => a + b, 0);
    const fixed = f.reduce((a, x, i) => a + (capped[i] ? x * 2 : 0), 0);
    const free = f.reduce((a, x, i) => a + (capped[i] ? 0 : x * e[i]), 0);
    const scale = (F - fixed) / free;
    let changed = false;
    w = e.map((x, i) => (capped[i] ? 2 : x * scale));
    w.forEach((x, i) => { if (!capped[i] && x > 2) { capped[i] = true; changed = true; } });
    if (!changed) break;
  }
  return w.map((x) => Math.min(2, x));
}

// ---------- 2. Concurrency cap (chronological on the combined list) ----------
function capK(K) {
  return (stream) => {
    const s = [...stream].sort((a, b) => a.entryTime - b.entryTime || a.exitTime - b.exitTime);
    const open = [], out = [];
    for (const t of s) {
      for (let i = open.length - 1; i >= 0; i--) if (open[i].exitTime <= t.entryTime) open.splice(i, 1);
      if (open.filter((o) => o.dir === t.dir).length >= K) continue;
      open.push(t); out.push(t);
    }
    return out;
  };
}

// ---------- Cost: r at other costs (entries/exits don't depend on cost) ----------
const rAtCost = new Map(); // cost -> Map(u.k -> Float64Array)
function rOf(t, cost) {
  if (cost === COST) return t.r;
  let m = rAtCost.get(cost); if (!m) rAtCost.set(cost, (m = new Map()));
  let arr = m.get(t.u.k);
  if (!arr) { const tr = L.backtest(W.frames[t.u.tf], L.STRATS[t.u.id], t.u.p, { cost }); arr = Float64Array.from(tr.map((x) => x.r)); m.set(t.u.k, arr); }
  return arr[t.j];
}
const idxOf = new Map(); // trade object -> index within its rule
universe.forEach((u) => u.trades.forEach((t, j) => idxOf.set(t, j)));

// ---------- Performance (weighted) ----------
function perf(all, days, cost) {
  let eq = 1, peak = 1, dd = 0, wsum = 0;
  const s = [...all].sort((x, y) => x.exitTime - y.exitTime);
  for (const t of s) { eq *= 1 + (RISK / 100) * rOf(t, cost) * t.w; peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak); wsum += t.w; }
  return { n: s.length, perDay: s.length / days, returnPct: (eq - 1) * 100, maxDDPct: dd * 100, avgW: s.length ? wsum / s.length : 1 };
}
const summarize = (tr, a, b, cost) => perf(tr.filter((x) => x.entryTime >= a && x.entryTime < b), dayCount(a, b), cost);

// ---------- One variant through the full adaptive procedure ----------
function run(v, cost = COST) {
  const post = v.post || ((s) => s);
  const raw = METHODS.map((m) => {
    const out = [];
    for (const [a, b] of PERIODS) {
      const { legs } = selectWith(m, a, v.sel);
      const ws = v.sizing ? edgeWeights(legs) : legs.map(() => 1);
      legs.forEach(({ u }, li) => {
        for (const t of u.trades) if (t.entryTime >= a && t.entryTime < b && (!v.exec || v.exec(t))) out.push({ dir: t.dir, entryTime: t.entryTime, exitTime: t.exitTime, r: t.r, u, j: idxOf.get(t), w: ws[li] });
      });
    }
    return out;
  });
  const streams = raw.map(post);
  const final = [];
  for (const [a, b] of PERIODS) {
    let pick = METHODS.findIndex((m) => selectWith(m, a, v.sel).perDay >= MIN_PER_DAY);
    if (pick < 0) pick = 0;
    const from = Math.max(Y23, a - 365.25 * DAYMS);
    if (a - Y23 >= 90 * DAYMS) {
      let best = -Infinity;
      METHODS.forEach((m, k) => {
        if (selectWith(m, a, v.sel).perDay < MIN_PER_DAY) return;
        const tr = streams[k].filter((t) => t.exitTime >= from && t.exitTime < a);
        if (tr.length < 50) return;
        const r = ratio(perf(tr, dayCount(from, a), cost));
        if (r > best) { best = r; pick = k; }
      });
    }
    final.push(...raw[pick].filter((t) => t.entryTime >= a && t.entryTime < b));
  }
  const tr = post(final);
  return { oos: summarize(tr, Y23, Y26, cost), y26: summarize(tr, Y26, end, cost) };
}

// ---------- Variants ----------
const V = {
  baseline: {},
  news30: { exec: newsFilter(30) },
  news60: { exec: newsFilter(60) },
  cap1: { post: capK(1) },
  cap2: { post: capK(2) },
  cap3: { post: capK(3) },
  vol10_90: { exec: volFilter(0.10, 0.90) },
  size_edge: { sizing: true },
  // Diagnostics (not adoption candidates): the filter also applied to the selection-window stats.
  'news30+sel': { exec: newsFilter(30), sel: { tag: 'n30', f: newsFilter(30) } },
  'news60+sel': { exec: newsFilter(60), sel: { tag: 'n60', f: newsFilter(60) } },
  'vol10_90+sel': { exec: volFilter(0.10, 0.90), sel: { tag: 'v', f: volFilter(0.10, 0.90) } },
};
const combine = (names) => {
  const vs = names.map((n) => V[n]);
  const ex = vs.filter((x) => x.exec).map((x) => x.exec), po = vs.filter((x) => x.post).map((x) => x.post);
  return { exec: ex.length ? (t) => ex.every((f) => f(t)) : null, post: po.length ? (s) => po.reduce((a, f) => f(a), s) : null, sizing: vs.some((x) => x.sizing) };
};

const fmt = (p) => `${p.returnPct.toFixed(1).padStart(6)}% DD ${p.maxDDPct.toFixed(1).padStart(4)}% r/DD ${ratio(p).toFixed(2).padStart(5)} ${p.perDay.toFixed(2)}/d`;
const res = {};
const t0 = Date.now();
const names = arg('only') ? arg('only').split(',') : Object.keys(V);
if (!names.includes('baseline')) names.unshift('baseline');
console.log('\nVariant           2023-25 (decides)                               | 2026 (check only)                     | pass?');
for (const n of names) {
  res[n] = run(V[n]);
  const r = res[n], b = res.baseline;
  const pass = n !== 'baseline' && ratio(r.oos) >= 1.1 * ratio(b.oos) && r.oos.perDay >= 4.5 && r.oos.perDay <= 7;
  console.log(`${n.padEnd(17)} ${fmt(r.oos)} avgW ${r.oos.avgW.toFixed(2)} | ${fmt(r.y26)} | ${n === 'baseline' ? '-' : pass ? 'PASS' : 'no'} (${(100 * (ratio(r.oos) / ratio(b.oos) - 1)).toFixed(0)}%)`);
}
if (arg('combo')) {
  const cn = arg('combo').split(',');
  const r = run(combine(cn)), b = res.baseline;
  res.combo = r;
  console.log(`combo(${cn.join('+')}) ${fmt(r.oos)} | ${fmt(r.y26)} | ${(100 * (ratio(r.oos) / ratio(b.oos) - 1)).toFixed(0)}%`);
}
if (arg('costs')) {
  const list = ['baseline', ...(arg('costs') === true ? [] : arg('costs').split(','))];
  console.log('\nCost sensitivity (selections fixed at $0.40 as in adaptive.js; adaptive method pick re-run at each cost)');
  for (const n of list) for (const c of [0.2, 0.4, 0.6, 0.8]) {
    const v = n.includes('+') && !V[n] ? combine(n.split('+')) : V[n];
    const r = run(v, c);
    console.log(`  ${n.padEnd(16)} $${c.toFixed(1)}  2023-25 ${fmt(r.oos)} | 2026 ${fmt(r.y26)}`);
  }
}
console.log(`\n(${((Date.now() - t0) / 1000).toFixed(0)}s)`);
