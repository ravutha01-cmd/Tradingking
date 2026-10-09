/* Live engine for the official 5-a-day rule set (window.INTRADAY.legs): keeps a candle
 * cache per interval, fetches only new candles on refresh, and runs the same backtest
 * code as the research (scripts/research/lib.js) to find open positions, new signals
 * on the latest closed candle, and today's / recent trades. Used by the Desk and
 * Signals pages. */
(function (root) {
  'use strict';
  const SPAN = { '15m': 3000 * 900e3, '30m': 3000 * 1800e3, '1h': 3000 * 3600e3 };
  const KEEP = 3200;
  const cache = {};

  async function series(iv) {
    const now = Date.now();
    let c = cache[iv];
    if (!c) c = await root.History.fetchRange(iv, now - SPAN[iv]);
    else {
      const lastClosed = c.filter((x) => x.closed).at(-1);
      const fresh = await root.History.fetchRange(iv, lastClosed.time + 1);
      c = c.filter((x) => x.closed && x.time <= lastClosed.time).concat(fresh).slice(-KEEP);
    }
    cache[iv] = c;
    return c;
  }
  const toRows = (a) => a.filter((c) => c.closed).map((c) => [c.time, c.open, c.high, c.low, c.close]);

  async function compute() {
    const D = root.INTRADAY, R = root.Research;
    const now = Date.now();
    const [m15, m30, h1raw] = await Promise.all([series('15m'), series('30m'), series('1h')]);
    const forming = m15.at(-1);
    const h1 = R.build(toRows(h1raw), 60), h4 = R.build(toRows(h1raw), 240);
    const frames = { 15: R.build(toRows(m15), 15), 30: R.build(toRows(m30), 30), 60: h1, 240: h4 };
    for (const [tf, c] of Object.entries(frames)) c.htf = { h1: R.htfTrend(c, +tf, h1, 60), h4: R.htfTrend(c, +tf, h4, 240) };
    const price = forming ? forming.close : frames[15].at(-1).close;
    const dayAgo = m15.find((x) => x.time >= now - 86400e3);

    const today = root.Sessions.dayKey(now);
    const out = { now, price, forming, change24: dayAgo ? (price / dayAgo.open - 1) * 100 : null, open: [], pending: [], todays: [], recent: [], fresh: [] };
    for (const l of D.legs) {
      const c = frames[l.tf], strat = R.STRATS[l.id];
      const trades = R.backtest(c, strat, l.params, { cost: D.cost });
      const last = trades.at(-1);
      const isOpen = last && last.why === 'end';
      if (isOpen) {
        const risk = Math.abs(last.entry - last.stop);
        out.open.push({ l, dir: last.dir, entry: last.entry, stop: last.stop, target: last.target, time: last.entryTime, r: ((price - last.entry) * last.dir) / risk, toStop: Math.abs(price - last.stop) });
      }
      // A signal on the last closed candle: enter at the open of the candle forming now.
      const sig = !isOpen && R.entrySignal(c, strat, l.params, strat.prepare(c, l.params), c.length - 1);
      if (sig) {
        const p = { l, dir: sig.dir, entry: price, stop: sig.stop, target: sig.target, time: c.at(-1).time + l.tf * 60e3, pending: true };
        out.pending.push(p); out.todays.push(p); out.fresh.push(p);
      }
      for (const t of trades) {
        const row = { l, dir: t.dir, entry: t.entry, stop: t.stop, target: t.target, exit: t.exit, r: t.r, why: t.why, time: t.entryTime, exitTime: t.exitTime };
        if (root.Sessions.dayKey(t.entryTime) === today) { out.todays.push(row); out.fresh.push(row); }
        if (t.entryTime >= now - 7 * 86400e3) out.recent.push(row);
      }
    }
    out.todays.sort((a, b) => b.time - a.time);
    out.recent.sort((a, b) => b.time - a.time);
    const longs = out.open.filter((o) => o.dir === 1).length, shorts = out.open.length - longs;
    out.exposure = { longs, shorts, net: (longs - shorts) * D.riskPct, gross: out.open.length * D.riskPct };
    // Next decision point: the next 15-minute candle close.
    out.nextCheck = Math.ceil((now + 1) / 900e3) * 900e3;
    return out;
  }

  // Multi-timeframe bias from Binance klines (15m … weekly).
  async function bias() {
    const I = root.Indicators, F = root.Feeds.binance;
    const ivs = [['15m', '15m'], ['1h', '1H'], ['4h', '4H'], ['1d', 'D'], ['1w', 'W']];
    const sets = await Promise.all(ivs.map(([iv]) => F.fetchCandles(iv, 500)));
    return ivs.map(([, label], k) => {
      const c = sets[k], cl = c.map((x) => x.close);
      const e50 = I.ema(cl, 50).at(-1), e200 = I.ema(cl, 200).at(-1), last = cl.at(-1);
      const dir = e200 == null ? 0 : last > e50 && e50 > e200 ? 1 : last < e50 && e50 < e200 ? -1 : 0;
      return { tf: label, dir, rsi: I.rsi(cl, 14).at(-1), change: (last / c[0].close - 1) * 100, last };
    });
  }

  root.Engine = { compute, bias };
})(window);
