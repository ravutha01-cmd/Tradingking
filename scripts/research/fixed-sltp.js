#!/usr/bin/env node
/* Best XAUUSD strategy with a fixed 100-pip stop loss and a take profit above 150 pips.
 * (Gold pip = $0.10, so SL = $10 and TP = $15 / $20 / $25 / $30.)
 *
 * Every entry rule in lib.js (EMA cross, Donchian breakout, RSI(2) pullback, Bollinger
 * reversion, Asia-range breakout) on 5m / 15m / 30m / 1H charts, with optional 1H/4H trend
 * filter, London+NY session filter, day-trade close and a time limit, is backtested once
 * with the fixed stop and target ($0.40 cost per trade). The rule is then chosen
 * walk-forward: at each re-selection date only earlier data is used. Four selection
 * methods (all history vs last 2 years × yearly vs monthly re-selection) are compared on
 * out-of-sample 2023–2025; 2026 is the check. The current rule becomes the live strategy.
 * Writes data/research/fixed-sltp.json and js/sltp-data.js. */
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');
const S = require('../../js/sessions.js');

const root = path.join(__dirname, '../..');
const log = (...a) => console.log(...a);
const PIP = 0.1, SL_PIPS = 100, TP_PIPS = [150, 200, 250, 300];
const COST = 0.4, RISK = 1; // % of account per trade
const rows = JSON.parse(fs.readFileSync(path.join(root, 'data/cache/paxg-5m.json'), 'utf8'));
for (let i = 1; i < rows.length - 1; i++) { // flatten single-candle spikes (see run.js)
  const p = rows[i - 1][4], c = rows[i][4], n = rows[i + 1][4];
  if (Math.abs(c / p - 1) > 0.025 && Math.abs(n / c - 1) > 0.025 && Math.sign(c - p) !== Math.sign(n - c)) rows[i] = [rows[i][0], p, Math.max(p, n), Math.min(p, n), p];
}

const TFS = [5, 15, 30, 60];
const h1 = L.build(rows, 60), h4 = L.build(rows, 240);
const frames = {};
for (const tf of TFS) {
  const c = tf === 60 ? h1 : L.build(rows, tf);
  c.htf = { h1: L.htfTrend(c, tf, h1, 60), h4: L.htfTrend(c, tf, h4, 240) };
  frames[tf] = c;
}
const end = frames[5].at(-1).time + 1;
const dayCount = (() => { const days = frames[15].map((x) => [x.time, x.day]); return (a, b) => { const s = new Set(); for (const [t, d] of days) if (t >= a && t < b) s.add(d); return s.size; }; })();

// Entry rules only — stop and target are fixed.
const ENTRY = {
  ema: { fast: [10, 20], slow: [50, 100], atr: [2] },
  donchian: { n: [20, 55], m: [10], atr: [2] },
  pullback: { len: [2], lo: [10, 25], exit: [50], trend: [50, 200], atr: [2] },
  bbrev: { n: [20], atr: [2] },
  orb: { stop: ['mid'], tp: [1], minRangeAtr: [0, 0.5] },
};
const universe = [];
for (const tf of TFS) for (const [id, g] of Object.entries(ENTRY)) {
  const grid = { ...g, longOnly: [false], htf: tf === 60 ? ['none', 'h4'] : ['none', 'h1', 'h4'], sess: id === 'orb' ? ['all'] : ['all', 'ldnny'], eod: id === 'orb' ? [true] : [true, false], hold: [8, 48], tpPips: TP_PIPS };
  for (const p of L.combos(grid, L.STRATS[id].valid)) universe.push({ tf, id, p: { ...p, maxBars: Math.round((p.hold * 60) / tf) } });
}
log(`Backtesting ${universe.length} rules with SL ${SL_PIPS} pips ($${SL_PIPS * PIP}) and TP ${TP_PIPS.join('/')} pips…`);
let k = 0;
for (const u of universe) {
  u.trades = L.backtest(frames[u.tf], L.STRATS[u.id], u.p, { cost: COST, fixed: { sl: SL_PIPS * PIP, tp: u.p.tpPips * PIP }, minRiskPct: 0 });
  if (++k % 1000 === 0) log(`  ${k}/${universe.length}`);
}

function perf(trades, days) {
  const t = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  let eq = 1, peak = 1, dd = 0, wins = 0, sum = 0;
  const months = new Map();
  for (const x of t) {
    eq *= 1 + (RISK / 100) * x.r; peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak);
    if (x.r > 0) wins++; sum += x.r;
    const m = new Date(x.exitTime).toISOString().slice(0, 7); months.set(m, (months.get(m) || 0) + x.r);
  }
  const n = t.length;
  return { n, perDay: days ? n / days : 0, winRate: n ? wins / n : 0, avgR: n ? sum / n : 0, avgPips: n ? (sum / n) * SL_PIPS : 0, returnPct: (eq - 1) * 100, maxDDPct: dd * 100, positiveMonths: [...months.values()].filter((v) => v > 0).length, months: months.size };
}
const ratio = (p) => (p.maxDDPct > 0 ? p.returnPct / p.maxDDPct : p.returnPct > 0 ? 99 : 0);
const inWin = (tr, a, b) => tr.filter((t) => t.entryTime >= a && t.entryTime < b);

// Best single rule using only data in [a, b).
const selCache = new Map();
function select(lookback, b) {
  const YRS = { all: null, '2y': 2, '1y': 1, '6m': 0.5 };
  const a = lookback === 'all' ? 0 : b - YRS[lookback] * 365.25 * 86400e3;
  const key = `${a}|${b}`;
  if (selCache.has(key)) return selCache.get(key);
  let best = null;
  for (const u of universe) {
    const tr = inWin(u.trades, a, b);
    if (tr.length < (lookback === '6m' ? 25 : 40)) continue;
    const q = Math.floor(tr.length / 4);
    const folds = [0, 1, 2, 3].map((f) => { const s = tr.slice(f * q, f === 3 ? tr.length : (f + 1) * q); return s.reduce((x, t) => x + t.r, 0) / s.length; });
    if (folds.filter((v) => v > 0).length < 3) continue;
    const p = perf(tr, 0);
    if (p.avgR <= 0.05 || p.maxDDPct > 25 || p.returnPct <= 0) continue;
    const score = ratio(p);
    if (!best || score > best.score) best = { u, p, score };
  }
  selCache.set(key, best);
  return best;
}

const FREQ = {
  yearly: () => [2023, 2024, 2025, 2026].map((y) => Date.UTC(y, 0, 1)),
  quarterly: () => { const o = []; for (let y = 2023; y <= 2026; y++) for (let m = 0; m < 12; m += 3) { const t = Date.UTC(y, m, 1); if (t < end) o.push(t); } return o; },
  monthly: () => { const o = []; for (let y = 2023; y <= 2026; y++) for (let m = 0; m < 12; m++) { const t = Date.UTC(y, m, 1); if (t < end) o.push(t); } return o; },
};
const Y23 = Date.UTC(2023, 0, 1), Y26 = Date.UTC(2026, 0, 1);
const variants = [];
const LB_NAME = { all: 'all history', '2y': 'last 2 years', '1y': 'last 12 months', '6m': 'last 6 months' };
for (const lookback of ['all', '2y', '1y', '6m']) for (const freq of Object.keys(FREQ)) {
  const starts = FREQ[freq]();
  const trades = [], picks = [];
  starts.forEach((a, i) => {
    const b = starts[i + 1] || end;
    const s = select(lookback, a);
    if (!s) { picks.push({ from: a, rule: null }); return; }
    picks.push({ from: a, rule: s.u });
    trades.push(...inWin(s.u.trades, a, b));
  });
  const v = { name: `${freq} re-selection · ${LB_NAME[lookback]}`, lookback, freq, trades, picks };
  v.oos = perf(inWin(trades, Y23, Y26), dayCount(Y23, Y26));
  v.y2026 = perf(inWin(trades, Y26, end), dayCount(Y26, end));
  v.years = Object.fromEntries([2023, 2024, 2025].map((y) => [y, perf(inWin(trades, Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1)), dayCount(Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1)))]));
  variants.push(v);
  log(`  ${v.name.padEnd(44)} 2023–25 ${v.oos.returnPct.toFixed(1)}% DD ${v.oos.maxDDPct.toFixed(1)}% · ${v.oos.n} trades · win ${(v.oos.winRate * 100).toFixed(0)}% │ 2026 ${v.y2026.returnPct.toFixed(1)}% DD ${v.y2026.maxDDPct.toFixed(1)}% · ${v.y2026.n} trades · win ${(v.y2026.winRate * 100).toFixed(0)}%`);
}

// Pick the selection method on 2023–2025 only.
const chosen = [...variants].filter((v) => v.oos.returnPct > 0 && v.oos.n >= 100).sort((a, b) => ratio(b.oos) - ratio(a.oos))[0];
if (!chosen) { log('No selection method was profitable on 2023–2025 out-of-sample.'); process.exit(1); }
const live = chosen.picks.at(-1).rule;
const st = L.STRATS[live.id];
const desc = `${st.describe(live.p).replace(/; stop [^;.]*|; take profit[^;.]*|; target[^;.]*|; exit[^;.]*|; max \d+ bars/g, '')}`;
log(`\nChosen on 2023–25: ${chosen.name}`);
log(`  2026 check: ${chosen.y2026.returnPct.toFixed(1)}% · DD ${chosen.y2026.maxDDPct.toFixed(1)}% · ${chosen.y2026.n} trades (${chosen.y2026.perDay.toFixed(2)}/day) · win ${(chosen.y2026.winRate * 100).toFixed(0)}% · avg ${chosen.y2026.avgPips.toFixed(0)} pips`);
log(`  Live rule (chosen ${new Date(chosen.picks.at(-1).from).toISOString().slice(0, 10)}): ${live.tf}m ${live.id} TP ${live.p.tpPips} pips ${JSON.stringify(live.p)}`);

// Cost sensitivity for the chosen record (selection kept at $0.40).
const costCurve = [0.2, 0.4, 0.6, 0.8].map((cost) => {
  const tr = [];
  const starts = FREQ[chosen.freq]();
  starts.forEach((a, i) => {
    const r = chosen.picks[i].rule;
    if (!r) return;
    tr.push(...inWin(L.backtest(frames[r.tf], L.STRATS[r.id], r.p, { cost, fixed: { sl: SL_PIPS * PIP, tp: r.p.tpPips * PIP }, minRiskPct: 0 }), a, starts[i + 1] || end));
  });
  return { cost, oos: perf(inWin(tr, Y23, Y26), 0), y2026: perf(inWin(tr, Y26, end), 0) };
});
log('  cost: ' + costCurve.map((c) => `$${c.cost}: 23–25 ${c.oos.returnPct.toFixed(0)}% / 2026 ${c.y2026.returnPct.toFixed(0)}%`).join(' · '));

let eq = 100;
const curve = [...inWin(chosen.trades, Y23, end)].sort((a, b) => a.exitTime - b.exitTime).map((t) => { eq *= 1 + (RISK / 100) * t.r; return [t.exitTime, +eq.toFixed(2)]; });
const strip = (v) => ({ name: v.name, oos: v.oos, y2026: v.y2026, years: v.years });
const out = {
  generatedAt: new Date().toISOString(), pip: PIP, slPips: SL_PIPS, cost: COST, riskPct: RISK, universe: universe.length,
  chosen: { ...strip(chosen), picks: chosen.picks.map((x) => ({ from: x.from, rule: x.rule && { tf: x.rule.tf, id: x.rule.id, params: x.rule.p } })) },
  variants: variants.map(strip),
  live: { tf: live.tf, id: live.id, label: st.label, params: live.p, tpPips: live.p.tpPips, rules: desc, since: chosen.picks.at(-1).from,
    record: perf(inWin(live.trades, 0, end), 0), y2026: perf(inWin(live.trades, Y26, end), dayCount(Y26, end)) },
  costCurve: costCurve.map((c) => ({ cost: c.cost, oos: c.oos.returnPct, y2026: c.y2026.returnPct })),
  curve: curve.filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 600)) === 0 || i === a.length - 1),
};
fs.writeFileSync(path.join(root, 'data/research/fixed-sltp.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(root, 'js/sltp-data.js'), '/* Generated by scripts/research/fixed-sltp.js */\nwindow.SLTP = ' + JSON.stringify(out) + ';\n');
log('Wrote data/research/fixed-sltp.json and js/sltp-data.js');
