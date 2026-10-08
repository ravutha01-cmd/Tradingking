#!/usr/bin/env node
/* Re-selection frequency and adaptive method choice for the 5-a-day rule set.
 *
 * Variants:
 *   • each of the 8 selection methods, re-choosing the rules every year, quarter or month
 *     (always using only data before the re-selection date);
 *   • "adaptive": at each re-selection, use the method whose own out-of-sample trades
 *     over the previous 12 months had the best return ÷ drawdown.
 * The variant is picked on out-of-sample 2023–2025 (4–7 signals/day, best return ÷ DD);
 * 2026 is reported as the check. Its current rule set (chosen with data up to the start
 * of the current period) becomes the live Signals rule set.
 * Writes data/research/adaptive.json and js/intraday-data.js. */
const fs = require('fs');
const path = require('path');
const { L, root, universe, METHODS, mName, select, trade, perf, dayCount, yStart, log, COST, RISK, end } = require('./wf-core.js');

const Y23 = yStart(2023), Y26 = yStart(2026);
const FREQS = {
  yearly: (y, i) => Date.UTC(y, 0, 1),
  quarterly: (y, i) => Date.UTC(y, i * 3, 1),
  monthly: (y, i) => Date.UTC(y, i, 1),
};
const PER_YEAR = { yearly: 1, quarterly: 4, monthly: 12 };
const periods = (freq) => {
  const out = [];
  for (let y = 2023; y <= 2026; y++) for (let i = 0; i < PER_YEAR[freq]; i++) { const a = FREQS[freq](y, i); if (a < end) out.push(a); }
  return out.map((a, k, arr) => [a, k + 1 < arr.length ? arr[k + 1] : end]);
};

function summarize(trades, a, b) {
  const t = trades.filter((x) => x.entryTime >= a && x.entryTime < b).sort((x, y) => x.exitTime - y.exitTime);
  return perf(t, dayCount(a, b));
}
const MIN_PER_DAY = 4.5; // the rule set must deliver ~5 signals/day
const ratio = (p) => (p.maxDDPct > 0 ? p.returnPct / p.maxDDPct : p.returnPct > 0 ? 99 : 0);

const variants = [];
for (const freq of Object.keys(FREQS)) {
  const P = periods(freq);
  // Each method's out-of-sample trades, period by period.
  const methodTrades = METHODS.map((m) => {
    const all = [];
    for (const [a, b] of P) all.push(...trade(select(m, a).legs, a, b));
    return all;
  });
  METHODS.forEach((m, k) => variants.push({ name: `${freq} · ${mName(m)}`, freq, method: m, trades: methodTrades[k] }));
  // Adaptive: pick the method with the best trailing-12-month out-of-sample return ÷ DD.
  const DEFAULT = 0;
  const adTrades = [], choices = [];
  for (const [a, b] of P) {
    let pick = METHODS.findIndex((m) => select(m, a).perDay >= MIN_PER_DAY);
    if (pick < 0) pick = DEFAULT;
    const from = Math.max(Y23, a - 365.25 * 86400e3);
    if (a - Y23 >= 90 * 86400e3) {
      let bestR = -Infinity;
      METHODS.forEach((m, k) => {
        if (select(m, a).perDay < MIN_PER_DAY) return; // must reach ~5/day at this date (known at time a)
        const tr = methodTrades[k].filter((t) => t.exitTime >= from && t.exitTime < a);
        if (tr.length < 50) return;
        const r = ratio(perf(tr, dayCount(from, a)));
        if (r > bestR) { bestR = r; pick = k; }
      });
    }
    choices.push({ from: a, method: mName(METHODS[pick]) });
    adTrades.push(...methodTrades[pick].filter((t) => t.entryTime >= a && t.entryTime < b));
  }
  variants.push({ name: `${freq} · adaptive (best method of the last 12 months)`, freq, adaptive: true, trades: adTrades, choices });
}

for (const v of variants) {
  v.oos = summarize(v.trades, Y23, Y26);
  v.y2026 = summarize(v.trades, Y26, end);
  v.years = Object.fromEntries([2023, 2024, 2025].map((y) => [y, summarize(v.trades, yStart(y), yStart(y + 1))]));
  v.record = summarize(v.trades, Y23, end);
}
log('Variant (rules re-chosen …)                                              2023–25           2026');
for (const v of [...variants].sort((a, b) => ratio(b.oos) - ratio(a.oos))) {
  log(`  ${v.name.padEnd(68)} ${v.oos.returnPct.toFixed(1).padStart(6)}% DD ${v.oos.maxDDPct.toFixed(1).padStart(4)}% ${v.oos.perDay.toFixed(1)}/d │ ${v.y2026.returnPct.toFixed(1).padStart(6)}% DD ${v.y2026.maxDDPct.toFixed(1).padStart(4)}% ${v.y2026.perDay.toFixed(1)}/d`);
}

// Pick on 2023–2025 only.
const eligible = variants.filter((v) => v.oos.perDay >= MIN_PER_DAY && v.oos.perDay <= 7 && v.oos.returnPct > 0).sort((a, b) => ratio(b.oos) - ratio(a.oos));
const best = eligible[0];
const rank26 = [...variants].filter((v) => v.y2026.perDay >= MIN_PER_DAY && v.y2026.perDay <= 7).sort((a, b) => ratio(b.y2026) - ratio(a.y2026));
log(`\nChosen on 2023–2025: ${best.name}`);
log(`  2023–25 ${best.oos.returnPct.toFixed(1)}% (DD ${best.oos.maxDDPct.toFixed(1)}%) · 2026 ${best.y2026.returnPct.toFixed(1)}% (DD ${best.y2026.maxDDPct.toFixed(1)}%, ${best.y2026.perDay.toFixed(1)}/day, ratio ${ratio(best.y2026).toFixed(2)}) · rank in 2026 among ${rank26.length} variants with ${MIN_PER_DAY}–7/day: ${rank26.indexOf(best) + 1}`);

// The live rule set: chosen with data up to the start of the current period.
const P = periods(best.freq);
const [curStart] = P[P.length - 1];
let method = best.method;
if (best.adaptive) method = METHODS.find((m) => mName(m) === best.choices.at(-1).method);
const live = select(method, curStart);
log(`  live rules: chosen on data before ${new Date(curStart).toISOString().slice(0, 10)} with ${mName(method)} → ${live.legs.length} rules, ${live.perDay.toFixed(1)}/day`);
const legs = live.legs.map(({ u, s }) => {
  const t26 = perf(u.trades.filter((t) => t.entryTime >= Y26), dayCount(Y26, end));
  return { tf: u.tf, id: u.id, label: L.STRATS[u.id].label, params: u.p, rules: L.STRATS[u.id].describe(u.p), train: { n: s.n, perDay: s.perDay, avgR: s.avgR }, ytd: { n: t26.n, perDay: t26.perDay, avgR: t26.avgR, winRate: t26.winRate } };
});

// Cost sensitivity and equity curve of the chosen variant's out-of-sample record.
const recordAtCost = (cost) => {
  if (cost === COST) return best.trades;
  const out = [];
  for (const [a, b] of P) {
    const m = best.adaptive ? METHODS.find((x) => mName(x) === best.choices.find((c) => c.from === a).method) : best.method;
    for (const { u } of select(m, a).legs) out.push(...L.backtest(require('./wf-core.js').frames[u.tf], L.STRATS[u.id], u.p, { cost }).filter((t) => t.entryTime >= a && t.entryTime < b));
  }
  return out;
};
const costCurve = [0.2, 0.3, 0.4, 0.5, 0.6, 0.8].map((cost) => { const p = summarize(recordAtCost(cost), Y23, end); return { cost, avgR: p.avgR, returnPct: p.returnPct }; });
log('  cost sensitivity 2023→now: ' + costCurve.map((c) => `$${c.cost}: ${c.returnPct.toFixed(1)}%`).join(' · '));
let eq = 100;
const curve = [...best.trades].sort((a, b) => a.exitTime - b.exitTime).map((t) => { eq *= 1 + (RISK / 100) * t.r; return [t.exitTime, +eq.toFixed(2)]; }).filter((_, i, a) => i % 3 === 0 || i === a.length - 1);

const strip = (v) => ({ name: v.name, freq: v.freq, adaptive: !!v.adaptive, oos: v.oos, y2026: v.y2026, years: v.years });
const out = {
  generatedAt: new Date().toISOString(), method: 'walk-forward, ' + best.name, cost: COST, riskPct: RISK, testStart: Y23,
  chosenMethod: best.name, variants: variants.map(strip), rank2026: rank26.indexOf(best) + 1, of2026: rank26.length,
  years: { ...best.years, 2026: best.y2026 }, record: best.record, ytd: best.y2026, liveFrom: curStart, liveMethod: mName(method),
  choices: best.choices || null, legs, costCurve, curve,
  // Keep the per-method table shape used by the Signals page (yearly re-selection).
  methods: variants.filter((v) => v.freq === best.freq && !v.adaptive).map((v) => ({ name: v.name, years: { ...v.years, 2026: v.y2026 }, oos: v.oos })),
};
fs.writeFileSync(path.join(root, 'data/research/adaptive.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(root, 'js/intraday-data.js'), '/* Generated by scripts/research/adaptive.js */\nwindow.INTRADAY = ' + JSON.stringify(out) + ';\n');
log('\nWrote data/research/adaptive.json and js/intraday-data.js');
