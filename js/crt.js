/* Candle Range Theory (CRT) on 4H.
 *
 * Candle 1 (C1) sets a range (its high/low). Candle 2 (C2) sweeps one side of that
 * range — trades beyond the high or low, taking liquidity — then closes back inside.
 *   Bearish CRT: C2.high > C1.high and C2 closes back below C1.high -> short,
 *                stop above C2.high, target the middle or the low of C1.
 *   Bullish CRT: C2.low < C1.low and C2 closes back above C1.low -> long,
 *                stop below C2.low, target the middle or the high of C1.
 * Entry is the close of C2 (= open of C3).
 *
 * Optional filters:
 *   session — only trade when C2 is one of the chosen NY 4H candles (e.g. the key
 *             1 AM / 5 AM / 9 AM NY CRT candles). Needs NY-aligned candles (Sessions.build4h).
 *   bias    — higher-timeframe direction: previous daily candle, daily close vs daily
 *             EMA20, or previous weekly candle. Only trades in that direction.
 *   zone    — premium/discount: longs only below the previous day's midpoint, shorts above.
 * Daily/weekly candles are built from the 4H candles and only completed ones are used,
 * so there is no look-ahead.
 *
 * Also contains a backtester, a grid-search optimizer with a train/test split,
 * and a journal that records live setups and resolves their outcomes.
 * Works in the browser (window.CRT) and Node (module.exports). */
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const I = node ? require('./indicators.js') : root.Indicators;
  const S = node ? require('./sessions.js') : root.Sessions;

  const DEFAULT_PARAMS = {
    minRangeAtr: 1,     // C1 range must be >= this × ATR(14)
    maxSweep: 0.5,      // how far C2 may poke beyond C1, as a fraction of C1 range
    closeDepth: 0,      // C2 must close at least this fraction of the range back inside
    trend: 'none',      // 'none' | 'ema50' | 'ema200' — only trade with the trend
    target: 'opposite', // 'mid' (50% of C1) | 'opposite' (other side of C1)
    slBufferAtr: 0.1,   // extra stop distance beyond the C2 wick, × ATR
    minRR: 1,           // skip setups whose reward:risk is below this
    maxBars: 6,         // close the trade at market after this many 4H candles
    session: 'all',     // 'all' | 'key' | 'london' | 'newyork' | 'asia' — see Sessions.SESSIONS
    bias: 'none',       // 'none' | 'prevDay' | 'dailyEma' | 'prevWeek'
    zone: 'any',        // 'any' | 'pd' (premium/discount vs previous day's range)
  };

  const BIASES = {
    none: 'Off',
    prevDay: 'Previous daily candle direction',
    dailyEma: 'Daily close vs daily EMA20',
    prevWeek: 'Previous weekly candle direction',
  };

  // Round-trip trading cost in price units (spread + commission), charged on every trade.
  const DEFAULT_COST = 0.4;

  const GRID = {
    minRangeAtr: [0.75, 1, 1.5],
    maxSweep: [0.5, 1],
    closeDepth: [0],
    trend: ['none', 'ema200'],
    target: ['mid', 'opposite'],
    slBufferAtr: [0.25, 0.5],
    minRR: [0, 0.75, 1.5],
    maxBars: [3, 6, 12],
    session: Object.keys(S.SESSIONS),
    bias: Object.keys(BIASES),
    zone: ['any', 'pd'],
  };

  // Aggregate 4H candles into daily or weekly candles by NY trading-day/week key.
  function aggregate(candles, keyFn) {
    const out = [];
    for (const c of candles) {
      const k = keyFn(c.time);
      const last = out[out.length - 1];
      if (last && last.key === k) {
        last.high = Math.max(last.high, c.high); last.low = Math.min(last.low, c.low); last.close = c.close;
      } else out.push({ key: k, open: c.open, high: c.high, low: c.low, close: c.close });
    }
    return out;
  }

  /* Precompute indicators and higher-timeframe state once per candle set.
   * For each candle i, htf[i] describes the daily/weekly picture known at the moment
   * candle i closes: the previous completed day/week (a day completes with its 1 PM NY
   * candle), and the daily EMA20 over completed days. */
  function context(candles) {
    const closes = candles.map((c) => c.close);
    const nyHour = candles.map((c) => (c.nyHour != null ? c.nyHour : S.nyHour(c.time)));
    const days = aggregate(candles, S.dayKey);
    const weeks = aggregate(candles, S.weekKey);
    const dEma = I.ema(days.map((d) => d.close), 20);
    const dayIdx = new Map(days.map((d, i) => [d.key, i]));
    const weekIdx = new Map(weeks.map((w, i) => [w.key, i]));
    const htf = candles.map((c, i) => {
      const di = dayIdx.get(S.dayKey(c.time));
      const prevD = nyHour[i] === 13 ? di : di - 1; // last 4H candle of the day completes it
      const wi = weekIdx.get(S.weekKey(c.time));
      const d = days[prevD], w = weeks[wi - 1];
      return {
        prevDayDir: d ? Math.sign(d.close - d.open) : 0,
        prevDayMid: d ? (d.high + d.low) / 2 : null,
        prevDayHigh: d ? d.high : null, prevDayLow: d ? d.low : null,
        dailyEmaDir: d && dEma[prevD] != null ? Math.sign(d.close - dEma[prevD]) : 0,
        dailyEma: d ? dEma[prevD] : null,
        prevWeekDir: w ? Math.sign(w.close - w.open) : 0,
      };
    });
    return { atr: I.atr(candles, 14), ema50: I.ema(closes, 50), ema200: I.ema(closes, 200), nyHour, htf };
  }

  // Direction the higher timeframe allows: 1 (longs), -1 (shorts) or 0 (no bias available).
  function biasDir(h, bias) {
    if (bias === 'prevDay') return h.prevDayDir;
    if (bias === 'dailyEma') return h.dailyEmaDir;
    if (bias === 'prevWeek') return h.prevWeekDir;
    return null;
  }

  // Detect a CRT setup where candles[i] is C2 (closed) and candles[i-1] is C1.
  function detect(candles, i, p, ctx) {
    if (i < 1) return null;
    const c1 = candles[i - 1], c2 = candles[i];
    const atr = ctx.atr[i - 1];
    if (atr == null) return null;
    const sess = S.SESSIONS[p.session || 'all'];
    if (sess && sess.hours && !sess.hours.includes(ctx.nyHour[i])) return null;
    const range = c1.high - c1.low;
    if (range <= 0 || range < p.minRangeAtr * atr) return null;

    let dir = 0;
    if (c2.high > c1.high && c2.close < c1.high - p.closeDepth * range && c2.close > c1.low &&
        (c2.high - c1.high) <= p.maxSweep * range) dir = -1;
    else if (c2.low < c1.low && c2.close > c1.low + p.closeDepth * range && c2.close < c1.high &&
        (c1.low - c2.low) <= p.maxSweep * range) dir = 1;
    if (!dir) return null;

    if (p.trend !== 'none') {
      const ema = ctx[p.trend][i];
      if (ema == null) return null;
      if (dir === 1 && c2.close < ema) return null;
      if (dir === -1 && c2.close > ema) return null;
    }

    const h = ctx.htf[i];
    if (p.bias && p.bias !== 'none' && biasDir(h, p.bias) !== dir) return null;
    if (p.zone === 'pd') {
      if (h.prevDayMid == null) return null;
      if (dir === 1 && c2.close > h.prevDayMid) return null;   // buy only at a discount
      if (dir === -1 && c2.close < h.prevDayMid) return null;  // sell only at a premium
    }

    const entry = c2.close;
    const sl = dir === 1 ? c2.low - p.slBufferAtr * atr : c2.high + p.slBufferAtr * atr;
    const tp = p.target === 'mid' ? (c1.high + c1.low) / 2 : dir === 1 ? c1.high : c1.low;
    const risk = Math.abs(entry - sl);
    const reward = (tp - entry) * dir;
    if (risk <= 0 || reward <= 0) return null;
    const rr = reward / risk;
    if (rr < p.minRR) return null;
    return {
      index: i, time: c2.time, nyHour: ctx.nyHour[i], dir, side: dir === 1 ? 'LONG' : 'SHORT',
      entry, sl, tp, risk, rr, c1High: c1.high, c1Low: c1.low,
    };
  }

  // Walk forward from the candle after entry. If stop and target are both inside one
  // candle we assume the stop hit first (conservative).
  function simulate(candles, setup, p, cost = 0) {
    const { dir, entry, sl, tp, risk } = setup;
    const c = cost / risk; // cost expressed in R
    const last = Math.min(candles.length - 1, setup.index + p.maxBars);
    for (let j = setup.index + 1; j <= last; j++) {
      const k = candles[j];
      const hitSl = dir === 1 ? k.low <= sl : k.high >= sl;
      const hitTp = dir === 1 ? k.high >= tp : k.low <= tp;
      if (hitSl) return { outcome: 'loss', exit: sl, exitIndex: j, r: -1 - c };
      if (hitTp) return { outcome: 'win', exit: tp, exitIndex: j, r: setup.rr - c };
    }
    if (last < setup.index + p.maxBars) return { outcome: 'open', exitIndex: null, r: 0 };
    const exit = candles[last].close;
    return { outcome: 'timeout', exit, exitIndex: last, r: ((exit - entry) * dir) / risk - c };
  }

  function stats(trades) {
    const closed = trades.filter((t) => t.outcome !== 'open');
    let total = 0, gross = 0, loss = 0, peak = 0, maxDD = 0, wins = 0;
    const equity = [];
    for (const t of closed) {
      total += t.r;
      if (t.r > 0) { gross += t.r; wins++; } else loss -= t.r;
      peak = Math.max(peak, total);
      maxDD = Math.max(maxDD, peak - total);
      equity.push({ time: t.time, equity: total });
    }
    const n = closed.length;
    return {
      trades: n, wins, winRate: n ? wins / n : 0, totalR: total,
      expectancy: n ? total / n : 0,
      profitFactor: loss ? gross / loss : gross > 0 ? Infinity : 0,
      maxDD, equity,
    };
  }

  // One position at a time: a new setup is only taken after the previous trade exits.
  function backtest(candles, p, opts = {}) {
    const ctx = opts.ctx || context(candles);
    const cost = opts.cost ?? DEFAULT_COST;
    const from = Math.max(1, opts.from ?? 1), to = Math.min(candles.length - 1, opts.to ?? candles.length - 1);
    const trades = [];
    let busyUntil = -1;
    for (let i = from; i <= to; i++) {
      if (i <= busyUntil || !candles[i].closed) continue;
      const s = detect(candles, i, p, ctx);
      if (!s) continue;
      const res = simulate(candles, s, p, cost);
      trades.push({ ...s, ...res });
      busyUntil = res.exitIndex ?? candles.length;
    }
    return { trades, stats: stats(trades) };
  }

  function combos(grid) {
    let out = [{}];
    for (const [k, vals] of Object.entries(grid)) {
      const next = [];
      for (const o of out) for (const v of vals) next.push({ ...o, [k]: v });
      out = next;
    }
    return out;
  }

  /* Robustness score. The training period is cut into `folds` consecutive slices and
   * each parameter set is backtested on every slice. A set scores well only if it is
   * profitable consistently (mean expectancy minus its spread across slices), backed by
   * enough trades. This prefers stable rules over ones that got lucky in one period. */
  function robustScore(foldStats, minTrades) {
    const n = foldStats.reduce((a, s) => a + s.trades, 0);
    if (n < minTrades || foldStats.some((s) => s.trades < 3)) return -Infinity;
    const exps = foldStats.map((s) => s.expectancy);
    const mean = exps.reduce((a, b) => a + b, 0) / exps.length;
    const sd = Math.sqrt(exps.reduce((a, b) => a + (b - mean) ** 2, 0) / exps.length);
    return (mean - sd) * Math.sqrt(n);
  }

  /* Train = search the grid on the oldest `split` share of the data (scored with
   * robustScore over `folds` slices); test = backtest the chosen parameters on the
   * newest data, which the search never saw. That test result is an honest estimate.
   * Async + chunked so the browser stays responsive. */
  async function optimize(candles, opts = {}) {
    const split = opts.split ?? 0.7;
    const folds = opts.folds ?? 4;
    const minTrades = opts.minTrades ?? 40;
    const cost = opts.cost ?? DEFAULT_COST;
    const grid = opts.grid || GRID;
    const onProgress = opts.onProgress || (() => {});
    const ctx = context(candles);
    const cut = Math.floor(candles.length * split);
    const all = combos(grid);
    const results = [];
    for (let k = 0; k < all.length; k++) {
      const p = all[k];
      const foldStats = [];
      for (let f = 0; f < folds; f++) {
        foldStats.push(backtest(candles, p, { ctx, cost, from: Math.floor((cut * f) / folds) + 1, to: Math.floor((cut * (f + 1)) / folds) }).stats);
      }
      results.push({ params: p, folds: foldStats.map((s) => ({ trades: s.trades, expectancy: s.expectancy })), score: robustScore(foldStats, minTrades) });
      if (k % 25 === 24) { onProgress((k + 1) / all.length); await new Promise((r) => setTimeout(r, 0)); }
    }
    onProgress(1);
    results.sort((a, b) => b.score - a.score);
    const top = results.filter((r) => r.score > -Infinity).slice(0, opts.top ?? 10);
    for (const r of top) {
      r.train = backtest(candles, r.params, { ctx, cost, from: 1, to: cut - 1 }).stats;
      r.test = backtest(candles, r.params, { ctx, cost, from: cut, to: candles.length - 1 }).stats;
    }
    return {
      best: top[0] || null, top, tested: all.length, splitTime: candles[cut] && candles[cut].time,
      trainCandles: cut, testCandles: candles.length - cut, cost,
      robustCount: results.filter((r) => r.score > 0).length,
    };
  }

  /* One-at-a-time breakdown: keep `p` and swap just the session, bias or zone,
   * reporting training and test results for each option. Shows which filter helps. */
  function breakdown(candles, p, opts = {}) {
    const ctx = context(candles);
    const cost = opts.cost ?? DEFAULT_COST;
    const cut = Math.floor(candles.length * (opts.split ?? 0.7));
    const run = (q) => ({
      train: stats(backtest(candles, q, { ctx, cost, from: 1, to: cut - 1 }).trades),
      test: stats(backtest(candles, q, { ctx, cost, from: cut, to: candles.length - 1 }).trades),
    });
    const rows = [];
    for (const k of Object.keys(S.SESSIONS)) rows.push({ group: 'session', value: k, ...run({ ...p, session: k }) });
    for (const k of Object.keys(BIASES)) rows.push({ group: 'bias', value: k, ...run({ ...p, bias: k }) });
    for (const k of ['any', 'pd']) rows.push({ group: 'zone', value: k, ...run({ ...p, zone: k }) });
    return rows;
  }

  // Same grid with session/bias/zone switched off, to measure what the new filters add.
  const BASELINE_GRID = { ...GRID, session: ['all'], bias: ['none'], zone: ['any'] };

  /* Journal: record live setups from `startedAt` onwards and resolve their outcomes.
   * Returns a new journal array (newest first). */
  function updateJournal(journal, candles, p, startedAt, cost = DEFAULT_COST) {
    const ctx = context(candles);
    const byTime = new Map(journal.map((e) => [e.time, e]));
    for (let i = 1; i < candles.length; i++) {
      if (candles[i].time < startedAt || !candles[i].closed || byTime.has(candles[i].time)) continue;
      const s = detect(candles, i, p, ctx);
      if (s) byTime.set(s.time, { time: s.time, side: s.side, entry: s.entry, sl: s.sl, tp: s.tp, rr: s.rr, outcome: 'open', r: 0 });
    }
    const index = new Map(candles.map((c, i) => [c.time, i]));
    for (const e of byTime.values()) {
      if (e.outcome !== 'open' || !index.has(e.time)) continue;
      const setup = { index: index.get(e.time), dir: e.side === 'LONG' ? 1 : -1, entry: e.entry, sl: e.sl, tp: e.tp, rr: e.rr, risk: Math.abs(e.entry - e.sl) };
      const res = simulate(candles, setup, p, cost);
      e.outcome = res.outcome; e.r = res.r; e.exit = res.exit;
    }
    return [...byTime.values()].sort((a, b) => b.time - a.time);
  }

  // The live picture: the latest closed setup, and the range the forming candle may sweep.
  function current(candles, p) {
    const ctx = context(candles);
    const n = candles.length;
    const lastClosed = candles[n - 1].closed ? n - 1 : n - 2;
    let setup = null;
    for (let i = lastClosed; i > lastClosed - 3 && i > 0; i--) {
      const s = detect(candles, i, p, ctx);
      if (s) { s.barsAgo = lastClosed - i; s.result = simulate(candles, s, p, DEFAULT_COST); setup = s; break; }
    }
    const c1 = candles[lastClosed];
    const forming = candles[n - 1].closed ? null : candles[n - 1];
    return {
      setup, htf: ctx.htf[n - 1], nyHour: ctx.nyHour[n - 1], c1NyHour: ctx.nyHour[lastClosed],
      watch: { high: c1.high, low: c1.low, range: c1.high - c1.low, atr: ctx.atr[lastClosed], time: c1.time },
      forming,
    };
  }

  const api = { DEFAULT_PARAMS, DEFAULT_COST, GRID, BASELINE_GRID, BIASES, breakdown, robustScore, biasDir, context, detect, simulate, backtest, optimize, stats, combos, updateJournal, current };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CRT = api;
})(typeof window !== 'undefined' ? window : globalThis);
