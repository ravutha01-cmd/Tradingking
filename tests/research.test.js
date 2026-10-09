const test = require('node:test');
const assert = require('node:assert');
const L = require('../scripts/research/lib.js');
const N = require('../scripts/research/news.js');

test('release times convert from New York time to UTC across DST', () => {
  assert.strictEqual(new Date(N.eventTime('2026-10-14', '08:30')).toISOString(), '2026-10-14T12:30:00.000Z');
  assert.strictEqual(new Date(N.eventTime('2026-11-10', '08:30')).toISOString(), '2026-11-10T13:30:00.000Z');
  assert.strictEqual(new Date(N.eventTime('2026-10-28', '14:00')).toISOString(), '2026-10-28T18:00:00.000Z');
});

// A tiny strategy that buys on bar 1 with a fixed stop, to exercise the backtester.
const once = (stop, target) => ({
  prepare: (c) => ({ c }),
  entry: (ctx, i) => (i === 1 ? { dir: 1, stop, target } : null),
  exit: () => null,
});
const bars = (list) => list.map(([o, h, l, c], i) => ({ time: Date.UTC(2026, 0, 5, 14) + i * 3600e3, open: o, high: h, low: l, close: c }));

test('entries fill at the next open; a gap through the stop fills at the open', () => {
  const c = bars([[100, 101, 99, 100], [100, 101, 99, 100], [100, 102, 99.5, 101], [95, 96, 94, 95]]);
  const [t] = L.backtest(c, once(98), {}, { cost: 0 });
  assert.strictEqual(t.entry, 100);  // open of bar 2
  assert.strictEqual(t.exit, 95);    // gapped below the 98 stop → filled at the 95 open
  assert.strictEqual(t.r, -2.5);
});

test('targets hit intrabar; costs are charged in R', () => {
  const c = bars([[100, 101, 99, 100], [100, 101, 99, 100], [100, 104.5, 99.5, 104], [104, 105, 103, 104]]);
  const [t] = L.backtest(c, once(98, 104), {}, { cost: 0.4 });
  assert.strictEqual(t.why, 'target');
  assert.ok(Math.abs(t.r - (4 - 0.4) / 2) < 1e-9);
});

test('trades with an unrealistically tight stop are skipped', () => {
  const c = bars([[100, 101, 99, 100], [100, 101, 99, 100], [100, 102, 99.5, 101], [101, 102, 100, 101]]);
  assert.strictEqual(L.backtest(c, once(99.99), {}, { cost: 0 }).length, 0);
});

test('build makes NY-aligned 4H candles and skips the weekend', () => {
  const start = Date.parse('2026-07-03T12:00Z'); // Friday
  const rows = Array.from({ length: 12 * 12 }, (_, i) => [start + i * 300e3, 1, 2, 0, 1]); // Fri 12:00Z → Sat 00:00Z
  const c4 = L.build(rows, 240);
  assert.deepStrictEqual(c4.map((c) => c.nyHour), [5, 9, 13]); // Friday 8 AM (partial), 9 AM, 1 PM; then closed
});

test('higher-timeframe trend uses only HTF candles that have closed', () => {
  // A steadily rising 1H series: close > EMA50 > EMA200 once there is enough history.
  const H = Array.from({ length: 260 }, (_, k) => ({ time: k * 3600e3, close: 100 + k }));
  // A 15m candle ending exactly when HTF candle 249 closes sees the uptrend…
  assert.strictEqual(L.htfTrend([{ time: 250 * 3600e3 - 15 * 60e3 }], 15, H, 60)[0], 1);
  // …but early candles, before 200 HTF candles exist, get no trend.
  assert.strictEqual(L.htfTrend([{ time: 10 * 3600e3 }], 15, H, 60)[0], 0);
});

test('fixed stop/target mode sets SL and TP from the fill price and ignores rule exits', () => {
  const st = { prepare: (c) => ({ c }), entry: (ctx, i) => (i === 1 ? { dir: 1, stop: 50 } : null), exit: () => 'signal' };
  const c = bars([[100, 101, 99, 100], [100, 101, 99, 100], [102, 103, 101, 102], [102, 110, 101, 109], [109, 110, 108, 109]]);
  const [t] = L.backtest(c, st, {}, { cost: 0, fixed: { sl: 10, tp: 5 } });
  assert.strictEqual(t.entry, 102);
  assert.strictEqual(t.stop, 92);
  assert.strictEqual(t.why, 'target');   // rule exit 'signal' ignored; target 107 hit on the next candle
  assert.strictEqual(t.exit, 107);
  assert.strictEqual(t.r, 0.5);
});
