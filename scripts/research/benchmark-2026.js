#!/usr/bin/env node
/* Is the 5-a-day walk-forward rule set the best option for 2026?
 * Compares, on Jan 1 2026 → now, every approach built in this project plus 500 random
 * traders that take ~5 random-direction trades a day with the same stops, holding time
 * and costs. Ranked by return ÷ max drawdown (independent of position size).
 * Writes data/research/benchmark-2026.json and js/benchmark-data.js. */
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');
const CRT = require('../../js/crt.js');
const S = require('../../js/sessions.js');

const root = path.join(__dirname, '../..');
const rd = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const WF = rd('data/research/walkforward.json');
const ID = rd('data/research/intraday.json');
const RP = rd('data/research/report.json');
const Y26 = Date.UTC(2026, 0, 1);
const log = (...a) => console.log(...a);

const rows = rd('data/cache/paxg-5m.json');
for (let i = 1; i < rows.length - 1; i++) {
  const p = rows[i - 1][4], c = rows[i][4], n = rows[i + 1][4];
  if (Math.abs(c / p - 1) > 0.025 && Math.abs(n / c - 1) > 0.025 && Math.sign(c - p) !== Math.sign(n - c)) rows[i] = [rows[i][0], p, Math.max(p, n), Math.min(p, n), p];
}
const days26 = (() => { const s = new Set(); for (const r of rows) if (r[0] >= Y26 && !S.isClosed(r[0])) s.add(S.dayKey(r[0])); return s.size; })();

function equity(rs, riskPct) {
  let eq = 1, peak = 1, dd = 0;
  for (const r of rs) { eq *= 1 + (riskPct / 100) * r; peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak); }
  return { returnPct: (eq - 1) * 100, maxDDPct: dd * 100 };
}
const rows_ = [];
const add = (name, kind, perDay, ret, dd, note) => rows_.push({ name, kind, perDay, returnPct: ret, maxDDPct: dd, ratio: dd > 0 ? ret / dd : ret > 0 ? 99 : 0, note });

// 1. The chosen walk-forward 5-a-day rule set and the 7 other selection methods.
for (const m of WF.methods) {
  const y = m.years[2026];
  add(m.name === WF.chosenMethod ? `5-a-day walk-forward (chosen) — ${m.name}` : `5-a-day walk-forward — ${m.name}`, m.name === WF.chosenMethod ? 'chosen' : 'alt', y.perDay, y.returnPct, y.maxDDPct, m.name === WF.chosenMethod ? 'live on the Signals page' : 'other selection method');
}
// 2. Single train/test split 5-a-day (chosen on 2020–24).
add('5-a-day single split (chosen on 2020–24)', 'alt', ID.ytd.perDay, ID.ytd.returnPct, ID.ytd.maxDDPct, 'earlier version');
// 3. Trend portfolio from the research page (1H + 4H, 0.33% risk each).
if (RP.portfolio) add('Trend portfolio (Research page)', 'alt', RP.portfolio.ytd.n / days26, RP.portfolio.ytd.returnPct, RP.portfolio.ytd.maxDDPct, '~1 signal/day');
// 4. CRT 4H with its built-in trained settings.
{
  const H = 3600e3;
  const c4 = S.build4h(rows.map((r) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], closed: true })).filter((_, i) => i % 12 === 0 || true).reduce((acc, r) => {
    // aggregate 5m → 1h first (build4h expects hourly-or-finer candles)
    const k = Math.floor(r.time / H);
    const last = acc.at(-1);
    if (last && last.k === k) { last.high = Math.max(last.high, r.high); last.low = Math.min(last.low, r.low); last.close = r.close; } else acc.push({ k, time: k * H, open: r.open, high: r.high, low: r.low, close: r.close, closed: true });
    return acc;
  }, []), Date.now()).filter((x) => x.closed);
  const trained = fs.readFileSync(path.join(root, 'js/crt-trained.js'), 'utf8');
  const params = JSON.parse(trained.slice(trained.indexOf('{'), trained.lastIndexOf('}') + 1)).params;
  const bt = CRT.backtest(c4, params, { from: c4.findIndex((x) => x.time >= Y26) });
  const e = equity(bt.trades.filter((t) => t.outcome !== 'open').map((t) => t.r), 1);
  add('CRT 4H (trained, CRT Lab)', 'alt', bt.trades.length / days26, e.returnPct, e.maxDDPct, '1% risk per trade');
}
// 5. Buy and hold.
{
  const r26 = rows.filter((r) => r[0] >= Y26);
  let peak = r26[0][1], dd = 0;
  for (const r of r26) { peak = Math.max(peak, r[2]); dd = Math.max(dd, 1 - r[3] / peak); }
  add('Buy & hold gold', 'alt', 0, (r26.at(-1)[4] / r26[0][1] - 1) * 100, dd * 100, 'full position');
}

// 6. Random traders: ~5.4 random-direction trades/day on the 30m chart — three independent
// random streams (like the system's several rules), 3× ATR stop, held up to 24 candles
// (12 h), same $0.40 costs and 0.25% risk per trade. (The backtester itself shows zero
// edge on a synthetic random walk, so these traders have no built-in bias.)
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const c30 = L.build(rows, 30);
const from = c30.findIndex((x) => x.time >= Y26);
const target = WF.ytd.perDay;
const STREAMS = 3;
let prob = 0.2;
const atr30 = require('../../js/indicators.js').atr(c30, 14);
const randomStrat = {
  prepare: (c) => ({ c, a: atr30 }),
  entry: ({ c, a }, i) => (a[i] != null && rnd() < prob ? (rnd() < 0.5 ? { dir: 1, stop: c[i].close - 3 * a[i] } : { dir: -1, stop: c[i].close + 3 * a[i] }) : null),
  exit: () => null,
};
const randomTrader = () => {
  const tr = [];
  for (let k = 0; k < STREAMS; k++) tr.push(...L.backtest(c30, randomStrat, { maxBars: 24 }, { cost: 0.4, from }));
  return tr.sort((a, b) => a.exitTime - b.exitTime);
};
for (let k = 0; k < 10; k++) { const n = randomTrader().length / days26; prob = Math.min(0.95, prob * target / n); }
const sims = [];
for (let k = 0; k < 500; k++) {
  const tr = randomTrader();
  const e = equity(tr.map((t) => t.r), WF.riskPct);
  sims.push({ perDay: tr.length / days26, ...e, ratio: e.maxDDPct > 0 ? e.returnPct / e.maxDDPct : 0 });
}
sims.sort((a, b) => a.returnPct - b.returnPct);
const q = (p) => sims[Math.floor(p * (sims.length - 1))];
const chosen = rows_.find((r) => r.kind === 'chosen');
const beat = sims.filter((s) => s.returnPct < chosen.returnPct).length / sims.length;
const beatRatio = sims.filter((s) => s.ratio < chosen.ratio).length / sims.length;
add(`Random trader — median of 500 (${q(0.5).perDay.toFixed(1)}/day)`, 'random', q(0.5).perDay, q(0.5).returnPct, q(0.5).maxDDPct, `best of 500: ${sims.at(-1).returnPct.toFixed(1)}%`);

rows_.sort((a, b) => b.ratio - a.ratio);
log(`2026 (Jan 1 → ${new Date(rows.at(-1)[0]).toISOString().slice(0, 10)}, ${days26} trading days), ranked by return ÷ max drawdown:`);
rows_.forEach((r, i) => log(`  ${String(i + 1).padStart(2)}. ${r.name.padEnd(70)} ${r.perDay.toFixed(1).padStart(4)}/day  ${r.returnPct.toFixed(1).padStart(6)}%  DD ${r.maxDDPct.toFixed(1).padStart(5)}%  ratio ${r.ratio.toFixed(2)}`));
log(`Random traders: 5th–95th percentile ${q(0.05).returnPct.toFixed(1)}% … ${q(0.95).returnPct.toFixed(1)}%; chosen system beats ${(beat * 100).toFixed(1)}% on return and ${(beatRatio * 100).toFixed(1)}% on return÷DD.`);

// 7. The longer test: the full walk-forward record (2023 → now) vs random traders over the
// same period at the same frequency. One 10-month year is a single short market path.
const Y23 = Date.UTC(2023, 0, 1);
const days23 = (() => { const s = new Set(); for (const r of rows) if (r[0] >= Y23 && !S.isClosed(r[0])) s.add(S.dayKey(r[0])); return s.size; })();
const from23 = c30.findIndex((x) => x.time >= Y23);
const randomTrader23 = () => { const tr = []; for (let k = 0; k < STREAMS; k++) tr.push(...L.backtest(c30, randomStrat, { maxBars: 24 }, { cost: 0.4, from: from23 })); return tr.sort((a, b) => a.exitTime - b.exitTime); };
prob = 0.2;
for (let k = 0; k < 10; k++) { const n = randomTrader23().length / days23; prob = Math.min(0.95, prob * WF.record.perDay / n); }
const sims23 = [];
for (let k = 0; k < 500; k++) { const tr = randomTrader23(); const e = equity(tr.map((t) => t.r), WF.riskPct); sims23.push({ perDay: tr.length / days23, ...e, ratio: e.maxDDPct > 0 ? e.returnPct / e.maxDDPct : 0 }); }
sims23.sort((a, b) => a.returnPct - b.returnPct);
const q23 = (p) => sims23[Math.floor(p * (sims23.length - 1))];
const beat23 = sims23.filter((x) => x.returnPct < WF.record.returnPct).length / sims23.length;
const beat23r = sims23.filter((x) => x.ratio < WF.record.returnPct / WF.record.maxDDPct).length / sims23.length;
log(`2023 → now: walk-forward record ${WF.record.returnPct.toFixed(1)}% (DD ${WF.record.maxDDPct.toFixed(1)}%, ${WF.record.perDay.toFixed(1)}/day) vs random traders median ${q23(0.5).returnPct.toFixed(1)}% (5th–95th ${q23(0.05).returnPct.toFixed(1)}% … ${q23(0.95).returnPct.toFixed(1)}%, best ${sims23.at(-1).returnPct.toFixed(1)}%, ${q23(0.5).perDay.toFixed(1)}/day) — beats ${(beat23 * 100).toFixed(1)}% on return, ${(beat23r * 100).toFixed(1)}% on return÷DD.`);

const out = {
  since2023: { record: WF.record, random: { n: sims23.length, p5: q23(0.05).returnPct, p50: q23(0.5).returnPct, p95: q23(0.95).returnPct, best: sims23.at(-1).returnPct, beatReturn: beat23, beatRatio: beat23r, perDay: q23(0.5).perDay } },
  generatedAt: new Date().toISOString(), from: Y26, to: rows.at(-1)[0], days: days26, ranking: rows_,
  random: { n: sims.length, p5: q(0.05).returnPct, p50: q(0.5).returnPct, p95: q(0.95).returnPct, best: sims.at(-1).returnPct, beatReturn: beat, beatRatio, perDay: q(0.5).perDay },
};
fs.writeFileSync(path.join(root, 'data/research/benchmark-2026.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(root, 'js/benchmark-data.js'), '/* Generated by scripts/research/benchmark-2026.js */\nwindow.BENCH = ' + JSON.stringify(out) + ';\n');
log('Wrote data/research/benchmark-2026.json and js/benchmark-data.js');
