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
const { L, root, frames, universe, inWin, METHODS, mName, select, trade, perf, dayCount, yStart, log, COST, RISK, TARGET, end } = require('./wf-core.js');
const YEARS = [2023, 2024, 2025, 2026];

// ---------- 1. Compare methods on out-of-sample 2023–2025 ----------
log('\nWalk-forward (rules chosen on data before each year, traded in that year):');
const results = METHODS.map((m) => {
  const years = {};
  let oos = [];
  for (const y of YEARS) {
    const sel = select(m, yStart(y));
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
const sel26 = select(best.m, yStart(2026));
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
    for (const { u } of select(best.m, yStart(y)).legs) all.push(...L.backtest(frames[u.tf], L.STRATS[u.id], u.p, { cost }).filter((t) => t.entryTime >= yStart(y) && t.entryTime < b));
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
