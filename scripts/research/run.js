#!/usr/bin/env node
/* XAUUSD research: strategies on every timeframe, the best strategy for 2026, and news
 * (CPI / PPI / NFP / FOMC) behaviour. Needs data/cache/paxg-5m.json (run fetch-5m.js).
 * Writes data/research/report.json and js/research-data.js (used by research.html). */
const fs = require('fs');
const path = require('path');
const I = require('../../js/indicators.js');
const Signals = require('../../js/signals.js');
const S = require('../../js/sessions.js');
const L = require('./lib.js');
const N = require('./news.js');

const root = path.join(__dirname, '../..');
const rows = JSON.parse(fs.readFileSync(path.join(root, 'data/cache/paxg-5m.json'), 'utf8'));
// Clean single-candle spikes (e.g. 2025-03-18 07:20 UTC printed 3140 between 3027 and 3045):
// a close more than 2.5% away from both neighbours that reverses immediately is flattened.
let cleaned = 0;
for (let i = 1; i < rows.length - 1; i++) {
  const p = rows[i - 1][4], c = rows[i][4], n = rows[i + 1][4];
  if (Math.abs(c / p - 1) > 0.025 && Math.abs(n / c - 1) > 0.025 && Math.sign(c - p) !== Math.sign(n - c)) {
    rows[i] = [rows[i][0], p, Math.max(p, n), Math.min(p, n), p];
    cleaned++;
  }
}
const events = JSON.parse(fs.readFileSync(path.join(root, 'data/events/us-macro-events.json'), 'utf8')).events;

const TEST_START = Date.UTC(2025, 0, 1);
const Y2026 = Date.UTC(2026, 0, 1);
const COST = 0.4;
const TFS = [{ id: '15m', min: 15 }, { id: '1H', min: 60 }, { id: '4H', min: 240 }, { id: 'D', min: 1440 }];
const yrs = (a, b) => (b - a) / (365.25 * 86400e3);
const firstIdx = (c, t) => { const i = c.findIndex((x) => x.time >= t); return i < 0 ? c.length : i; };
const strip = (s) => { const { trades, ...rest } = s; return rest; };
const log = (...a) => console.log(...a);

// ---------- 1. Strategies on every timeframe ----------
function evaluateTf(tf) {
  const c = L.build(rows, tf.min);
  const cut = firstIdx(c, TEST_START), y26 = firstIdx(c, Y2026);
  const trainYears = yrs(c[0].time, c[cut].time), testYears = yrs(c[cut].time, c.at(-1).time), y26Years = yrs(c[y26].time, c.at(-1).time);
  const out = [];
  for (const [id, st] of Object.entries(L.STRATS)) {
    if (st.intradayOnly && tf.min > 60) continue;
    let best = null;
    for (const p of L.combos(st.grid, st.valid)) {
      const folds = [];
      for (let f = 0; f < 4; f++) {
        const a = Math.floor((cut * f) / 4), b = Math.floor((cut * (f + 1)) / 4) - 1;
        folds.push(L.stats(L.backtest(c, st, p, { cost: COST, from: a, to: b })));
      }
      const n = folds.reduce((x, s) => x + s.n, 0);
      if (n < 30 || folds.some((s) => s.n < 5)) continue;
      const avgs = folds.map((s) => s.avgR);
      const m = avgs.reduce((x, y) => x + y, 0) / 4;
      const sd = Math.sqrt(avgs.reduce((x, y) => x + (y - m) ** 2, 0) / 4);
      const score = (m - sd) * Math.sqrt(n);
      if (!best || score > best.score) best = { p, score, foldsPositive: avgs.filter((v) => v > 0).length, foldAvg: avgs };
    }
    if (!best) { out.push({ id, label: st.label, tf: tf.id, none: true }); continue; }
    const train = L.stats(L.backtest(c, st, best.p, { cost: COST, from: 0, to: cut - 1 }), trainYears);
    const testTrades = L.backtest(c, st, best.p, { cost: COST, from: cut, to: c.length - 1 });
    const test = L.stats(testTrades, testYears);
    const ytd = L.stats(testTrades.filter((t) => t.entryTime >= Y2026), y26Years);
    out.push({ id, label: st.label, tf: tf.id, params: best.p, rules: st.describe(best.p), score: best.score, foldsPositive: best.foldsPositive, foldAvg: best.foldAvg, train, test, ytd });
    log(`  ${tf.id.padEnd(3)} ${st.label.padEnd(26)} train ${train.avgR.toFixed(2)}R×${train.n} (${train.returnPct.toFixed(0)}%)  test ${test.avgR.toFixed(2)}R×${test.n} (${test.returnPct.toFixed(0)}%)  2026 ${ytd.returnPct.toFixed(0)}%  folds+ ${best.foldsPositive}/4`);
  }
  return { c, cut, y26, results: out };
}

function buyHold(c, a, b) {
  let peak = c[a].open, dd = 0;
  for (let i = a; i <= b; i++) { peak = Math.max(peak, c[i].high); dd = Math.max(dd, 1 - c[i].low / peak); }
  return { returnPct: (c[b].close / c[a].open - 1) * 100, maxDDPct: dd * 100, from: c[a].time, to: c[b].time };
}

// ---------- 3. Market now on every timeframe ----------
function snapshot(c, label) {
  const closes = c.map((x) => x.close);
  const e20 = I.ema(closes, 20).at(-1), e50 = I.ema(closes, 50).at(-1), e200 = I.ema(closes, 200).at(-1);
  const last = c.at(-1).close;
  const sig = Signals.analyze(c.slice(-500));
  const look = c.slice(-21, -1);
  const trend = last > e50 && e50 > e200 ? 'Uptrend' : last < e50 && e50 < e200 ? 'Downtrend' : 'Range / mixed';
  return {
    tf: label, close: last, ema20: e20, ema50: e50, ema200: e200, rsi: I.rsi(closes, 14).at(-1), atr: I.atr(c, 14).at(-1),
    trend, signal: sig.action, score: sig.score, high20: Math.max(...look.map((x) => x.high)), low20: Math.min(...look.map((x) => x.low)),
    time: c.at(-1).time,
  };
}

(async () => {
  log(`cleaned ${cleaned} spike candle(s)`);
  log(`5m candles: ${rows.length} (${new Date(rows[0][0]).toISOString()} → ${new Date(rows.at(-1)[0]).toISOString()})`);
  log('\n1) Strategy search — settings chosen on 2020–2024, tested on 2025–2026');
  const perTf = {};
  const matrix = [];
  for (const tf of TFS) {
    const r = evaluateTf(tf);
    perTf[tf.id] = r;
    matrix.push(...r.results);
  }

  // Benchmark: buy and hold, measured on daily candles.
  const d = perTf.D.c;
  const bench = {
    train: buyHold(d, 0, perTf.D.cut - 1), test: buyHold(d, perTf.D.cut, d.length - 1), ytd: buyHold(d, perTf.D.y26, d.length - 1),
  };
  log(`\nBuy & hold gold: 2020-24 ${bench.train.returnPct.toFixed(0)}% · 2025-26 ${bench.test.returnPct.toFixed(0)}% · 2026 ${bench.ytd.returnPct.toFixed(0)}%`);

  // 2. Best strategy for 2026 — picked on TRAINING data only: highest training Sharpe among
  // strategies profitable in at least 3 of the 4 training slices.
  const candidates = matrix.filter((m) => !m.none && m.foldsPositive >= 3 && m.train.avgR > 0);
  candidates.sort((a, b) => b.train.sharpe - a.train.sharpe);
  const firstPick = candidates[0] || null;
  // Drawdown-aware pick (added after seeing that the first rule chose a strategy with a 64%
  // training drawdown): training drawdown ≤ 25%, ranked by training return ÷ drawdown.
  const safe = candidates.filter((m) => m.train.maxDDPct <= 25 && m.train.returnPct > 0);
  safe.sort((a, b) => b.train.returnPct / Math.max(b.train.maxDDPct, 1) - a.train.returnPct / Math.max(a.train.maxDDPct, 1));
  const best = safe[0] || firstPick;
  if (firstPick) log(`\n2a) First pick (training Sharpe): ${firstPick.tf} ${firstPick.label} — train ${firstPick.train.returnPct.toFixed(0)}% (DD ${firstPick.train.maxDDPct.toFixed(0)}%) · test ${firstPick.test.returnPct.toFixed(0)}% (DD ${firstPick.test.maxDDPct.toFixed(0)}%) · 2026 ${firstPick.ytd.returnPct.toFixed(0)}%`);
  log('   Drawdown-aware ranking (training data):');
  for (const m of safe.slice(0, 6)) log(`   ${m.tf.padEnd(3)} ${m.label.padEnd(26)} train ${m.train.returnPct.toFixed(0)}% DD ${m.train.maxDDPct.toFixed(0)}% → test ${m.test.returnPct.toFixed(0)}% DD ${m.test.maxDDPct.toFixed(0)}% · 2026 ${m.ytd.returnPct.toFixed(0)}%`);
  let bestCurve = null;
  if (best) {
    const r = perTf[best.tf];
    const trades = L.backtest(r.c, L.STRATS[best.id], best.params, { cost: COST, from: 0, to: r.c.length - 1 });
    let eq = 100;
    bestCurve = trades.map((t) => { eq *= 1 + 0.01 * t.r; return [t.exitTime, +eq.toFixed(2)]; });
    best.recent = trades.slice(-15).map((t) => ({ dir: t.dir, entryTime: t.entryTime, exitTime: t.exitTime, entry: t.entry, exit: t.exit, r: +t.r.toFixed(2), why: t.why }));
    log(`\n2) Best by training data: ${best.tf} ${best.label} — ${best.rules}`);
    log(`   train ${best.train.returnPct.toFixed(0)}% (DD ${best.train.maxDDPct.toFixed(0)}%) · test ${best.test.returnPct.toFixed(0)}% (DD ${best.test.maxDDPct.toFixed(0)}%) · 2026 ${best.ytd.returnPct.toFixed(0)}%`);
  }
  // Portfolio: the top 3 of the drawdown-aware training ranking, traded together with
  // one third of the risk each (0.33% per trade, 1% in total). Chosen from training data only.
  let portfolio = null;
  if (safe.length >= 3) {
    const legs = safe.slice(0, 3);
    const all = [];
    for (const m of legs) {
      const r = perTf[m.tf];
      for (const t of L.backtest(r.c, L.STRATS[m.id], m.params, { cost: COST, from: 0, to: r.c.length - 1 })) all.push({ ...t, leg: `${m.tf} ${m.label}` });
    }
    all.sort((a, b) => a.exitTime - b.exitTime);
    const period = (from, to) => {
      let eq = 1, peak = 1, dd = 0, n = 0;
      for (const t of all) { if (t.entryTime < from || t.entryTime >= to) continue; eq *= 1 + (0.01 / 3) * t.r; peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak); n++; }
      return { n, returnPct: (eq - 1) * 100, maxDDPct: dd * 100 };
    };
    let eq = 100;
    portfolio = {
      legs: legs.map((m) => ({ id: m.id, tf: m.tf, label: m.label, rules: m.rules, params: m.params, train: strip(m.train), test: strip(m.test), ytd: strip(m.ytd) })),
      train: period(0, TEST_START), test: period(TEST_START, Infinity), ytd: period(Y2026, Infinity),
      curve: all.map((t) => { eq *= 1 + (0.01 / 3) * t.r; return [t.exitTime, +eq.toFixed(2)]; }),
      recent: all.slice(-12).map((t) => ({ leg: t.leg, dir: t.dir, entryTime: t.entryTime, exitTime: t.exitTime, entry: t.entry, exit: t.exit, r: +t.r.toFixed(2), why: t.why })),
    };
    log(`\n2b) Portfolio of the top 3 (0.33% risk each): train ${portfolio.train.returnPct.toFixed(0)}% DD ${portfolio.train.maxDDPct.toFixed(0)}% · test ${portfolio.test.returnPct.toFixed(0)}% DD ${portfolio.test.maxDDPct.toFixed(0)}% · 2026 ${portfolio.ytd.returnPct.toFixed(1)}% DD ${portfolio.ytd.maxDDPct.toFixed(1)}%`);
  }
  const holdCurve = d.filter((_, i) => i % 5 === 0).map((x) => [x.time, +((x.close / d[0].open) * 100).toFixed(2)]);

  // ---------- News ----------
  log('\n3) News study');
  const past = events.filter((e) => N.eventTime(e.date, e.timeNY) < rows.at(-1)[0]);
  const ms = N.measure(rows, past);
  const isTrain = (m) => m.T < TEST_START;
  const news = { measured: ms.length, byType: {}, rules: null };
  for (const type of ['CPI', 'PPI', 'NFP', 'FOMC']) {
    const all = ms.filter((m) => m.type === type);
    news.byType[type] = {
      all: N.summarize(all), train: N.summarize(all.filter(isTrain)), test: N.summarize(all.filter((m) => !isTrain(m))),
      y2026: N.summarize(all.filter((m) => m.T >= Y2026)),
      recent: all.slice(-8).map((m) => ({ date: m.date, move15: +m.move15.toFixed(2), move60: +m.move60.toFixed(2), move240: +m.move240.toFixed(2), first5Range: +m.first5Range.toFixed(2), volMult: m.baseRange ? +(m.first5Range / m.baseRange).toFixed(1) : null })),
    };
    const s = news.byType[type].all;
    log(`  ${type.padEnd(4)} n=${s.n}  first-5m range ×${s.volMultiple?.toFixed(1)} normal · median |move| 15m $${s.medAbs15.toFixed(1)} 1h $${s.medAbs60.toFixed(1)} 4h $${s.medAbs240.toFixed(1)} · first-15m direction continues ${(s.continuation * 100).toFixed(0)}%`);
  }
  news.rules = N.studyRules(rows, ms, isTrain);
  for (const [type, r] of Object.entries(news.rules)) {
    const t = r.top[0];
    log(`  rules ${type.padEnd(4)} best on train: ${t.rule} ${JSON.stringify(t.p)} train ${t.train.avgR.toFixed(2)}R×${t.train.n} → test ${t.test.avgR.toFixed(2)}R×${t.test.n}`);
  }
  // Strip per-trade lists to keep the report small.
  for (const r of Object.values(news.rules)) {
    for (const x of [...r.top, ...r.families]) { delete x.train.list; delete x.test.list; delete x.score; }
  }

  // ---------- Market now ----------
  const weekly = [];
  for (const x of d) {
    const k = S.weekKey(x.time);
    const w = weekly.at(-1);
    if (w && w.k === k) { w.high = Math.max(w.high, x.high); w.low = Math.min(w.low, x.low); w.close = x.close; }
    else weekly.push({ k, time: x.time, open: x.open, high: x.high, low: x.low, close: x.close });
  }
  const now = [snapshot(perTf['15m'].c, '15m'), snapshot(perTf['1H'].c, '1H'), snapshot(perTf['4H'].c, '4H'), snapshot(d, 'Daily'), snapshot(weekly, 'Weekly')];
  log('\nMarket now:', now.map((s) => `${s.tf} ${s.trend}/${s.signal}`).join(' · '));

  const upcoming = events.filter((e) => N.eventTime(e.date, e.timeNY) > Date.now()).slice(0, 10);

  const report = {
    generatedAt: new Date().toISOString(), symbol: 'PAXG/USDT (gold-backed token, tracks XAU/USD)', cost: COST, newsCost: N.NEWS_COST,
    period: { from: rows[0][0], to: rows.at(-1)[0], testStart: TEST_START },
    matrix: matrix.map((m) => (m.none ? m : { ...m, train: strip(m.train), test: strip(m.test), ytd: strip(m.ytd) })),
    benchmark: bench,
    best: best ? { ...best, train: strip(best.train), test: strip(best.test), ytd: strip(best.ytd) } : null,
    firstPick: firstPick ? { id: firstPick.id, tf: firstPick.tf, label: firstPick.label, rules: firstPick.rules, train: strip(firstPick.train), test: strip(firstPick.test), ytd: strip(firstPick.ytd) } : null,
    ranking: safe.slice(0, 8).map((m) => ({ id: m.id, tf: m.tf, label: m.label, train: strip(m.train), test: strip(m.test), ytd: strip(m.ytd) })),
    portfolio: portfolio ? { ...portfolio, curve: undefined } : null,
    curves: { best: bestCurve, portfolio: portfolio ? portfolio.curve : null, hold: holdCurve },
    news, now, upcoming,
  };
  fs.mkdirSync(path.join(root, 'data/research'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data/research/report.json'), JSON.stringify(report, null, 1));
  fs.writeFileSync(path.join(root, 'js/research-data.js'), '/* Generated by scripts/research/run.js */\nwindow.RESEARCH = ' + JSON.stringify(report) + ';\n');
  log('\nWrote data/research/report.json and js/research-data.js');
})().catch((e) => { console.error(e); process.exit(1); });
