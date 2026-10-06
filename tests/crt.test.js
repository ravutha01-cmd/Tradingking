const test = require('node:test');
const assert = require('node:assert');
const CRT = require('../js/crt.js');

const H = 4 * 3600e3;
const MON = Date.UTC(2026, 0, 5); // a Monday, 00:00 UTC
// Flat filler candles with a 10-point range, then the candles under test.
function series(tail) {
  const base = Array.from({ length: 30 }, (_, i) => ({ open: 100, high: 105, low: 95, close: 100 }));
  return base.concat(tail).map((c, i) => ({ time: MON + i * H, volume: 1, closed: true, ...c }));
}
const P = { ...CRT.DEFAULT_PARAMS, minRangeAtr: 1, maxSweep: 0.5, closeDepth: 0, trend: 'none', target: 'opposite', slBufferAtr: 0, minRR: 0, maxBars: 6 };

test('bearish CRT: sweep of C1 high that closes back inside', () => {
  const c = series([{ open: 100, high: 110, low: 90, close: 100 }, { open: 100, high: 113, low: 99, close: 104 }]);
  const s = CRT.detect(c, c.length - 1, P, CRT.context(c));
  assert.strictEqual(s.side, 'SHORT');
  assert.strictEqual(s.entry, 104);
  assert.strictEqual(s.sl, 113);
  assert.strictEqual(s.tp, 90);
});

test('bullish CRT targets the middle when target = mid', () => {
  const c = series([{ open: 100, high: 110, low: 90, close: 100 }, { open: 100, high: 101, low: 87, close: 95 }]);
  const s = CRT.detect(c, c.length - 1, { ...P, target: 'mid' }, CRT.context(c));
  assert.strictEqual(s.side, 'LONG');
  assert.strictEqual(s.tp, 100);
  assert.strictEqual(s.sl, 87);
});

test('no setup when C2 closes outside the range or sweeps too far', () => {
  const outside = series([{ open: 100, high: 110, low: 90, close: 100 }, { open: 100, high: 113, low: 99, close: 112 }]);
  assert.strictEqual(CRT.detect(outside, outside.length - 1, P, CRT.context(outside)), null);
  const deep = series([{ open: 100, high: 110, low: 90, close: 100 }, { open: 100, high: 125, low: 99, close: 104 }]);
  assert.strictEqual(CRT.detect(deep, deep.length - 1, P, CRT.context(deep)), null);
});

test('simulate: target hit is a win worth rr, stop hit is -1R, cost is charged', () => {
  const c = series([{ open: 100, high: 110, low: 90, close: 100 }, { open: 100, high: 113, low: 99, close: 104 },
    { open: 104, high: 105, low: 89, close: 90 }]);
  const s = CRT.detect(c, c.length - 2, P, CRT.context(c));
  const win = CRT.simulate(c, s, P, 0);
  assert.strictEqual(win.outcome, 'win');
  assert.ok(Math.abs(win.r - 14 / 9) < 1e-9);
  const lossC = c.slice(0, -1).concat({ ...c.at(-1), high: 114, low: 100 });
  const loss = CRT.simulate(lossC, s, P, 0.9);
  assert.strictEqual(loss.outcome, 'loss');
  assert.ok(Math.abs(loss.r - (-1.1)) < 1e-9);
});

test('journal records setups after the start time and resolves them', () => {
  const c = series([{ open: 100, high: 110, low: 90, close: 100 }, { open: 100, high: 113, low: 99, close: 104 }]);
  let j = CRT.updateJournal([], c, P, c.at(-1).time, 0);
  assert.strictEqual(j.length, 1);
  assert.strictEqual(j[0].outcome, 'open');
  c.push({ time: c.at(-1).time + H, open: 104, high: 105, low: 89, close: 90, volume: 1, closed: true });
  j = CRT.updateJournal(j, c, P, c.at(-2).time, 0);
  assert.strictEqual(j.length, 1);
  assert.strictEqual(j[0].outcome, 'win');
});

test('optimizer picks settings from training data and reports a test result', async () => {
  const c = series([]);
  for (let i = 0; i < 600; i++) {
    const b = 100 + Math.sin(i / 7) * 20;
    c.push({ time: c.at(-1).time + H, open: b, high: b + 6 + (i % 5), low: b - 6 - (i % 3), close: b + ((i % 4) - 1.5), volume: 1, closed: true });
  }
  const res = await CRT.optimize(c, { minTrades: 5, grid: { ...CRT.GRID, maxBars: [6], slBufferAtr: [0], session: ['all', 'key'], bias: ['none', 'prevDay'] } });
  assert.ok(res.tested > 0);
  if (res.best) assert.ok(res.best.test && typeof res.best.test.expectancy === 'number');
});

// ---------- Sessions & higher-timeframe bias ----------
const Sessions = require('../js/sessions.js');

test('NY offset follows US daylight saving', () => {
  assert.strictEqual(Sessions.nyOffset(Date.parse('2026-07-01T12:00Z')), -4 * 3600e3);
  assert.strictEqual(Sessions.nyOffset(Date.parse('2026-12-01T12:00Z')), -5 * 3600e3);
  assert.strictEqual(Sessions.nyOffset(Date.parse('2026-03-08T06:59Z')), -5 * 3600e3);
  assert.strictEqual(Sessions.nyOffset(Date.parse('2026-03-08T07:00Z')), -4 * 3600e3);
});

test('build4h makes NY-aligned candles and drops the weekend', () => {
  // Friday 3 Jul 2026 12:00Z → Monday 6 Jul 00:00Z, hourly.
  const start = Date.parse('2026-07-03T12:00Z');
  const hourly = Array.from({ length: 84 }, (_, i) => ({ time: start + i * 3600e3, open: i, high: i + 1, low: i - 1, close: i + 0.5, closed: true }));
  const c4 = Sessions.build4h(hourly, Date.parse('2026-08-01T00:00Z'));
  // Fri 8 AM NY (partial 5 AM candle), 9 AM, 1 PM, then nothing until Sun 5 PM NY.
  assert.deepStrictEqual(c4.slice(0, 6).map((c) => c.nyHour), [5, 9, 13, 17, 21, 1]);
  assert.strictEqual(new Date(c4[2].time).toISOString(), '2026-07-03T17:00:00.000Z');
  assert.strictEqual(c4[2].open, 5); assert.strictEqual(c4[2].close, 8.5);   // hours 17–20Z
  assert.strictEqual(new Date(c4[3].time).toISOString(), '2026-07-05T21:00:00.000Z');
  assert.ok(c4.every((c) => !Sessions.isClosed(c.time)));
});

// NY-aligned 4H candles from Sunday 4 Jan 2026 17:00 NY (EST): hours 17, 21, 1, 5, 9, 13, …
function nySeries(tail, lastFillerClose = 100) {
  const t0 = Date.UTC(2026, 0, 4, 22);
  const filler = Array.from({ length: 18 }, (_, i) => ({ open: 100, high: 105, low: 95, close: i === 17 ? lastFillerClose : 100 }));
  return filler.concat(tail).map((c, i) => ({ time: t0 + i * H, volume: 1, closed: true, ...c }));
}
const bearish = [{ open: 100, high: 110, low: 90, close: 100 }, { open: 100, high: 113, low: 99, close: 104 }];

test('session filter only allows the chosen NY candles as C2', () => {
  const c = nySeries(bearish);
  const ctx = CRT.context(c);
  const i = c.length - 1;
  assert.strictEqual(ctx.nyHour[i], 21);
  assert.ok(CRT.detect(c, i, { ...P, session: 'asia' }, ctx));
  assert.strictEqual(CRT.detect(c, i, { ...P, session: 'key' }, ctx), null);
});

test('previous-day bias blocks trades against it and allows trades with it', () => {
  const up = nySeries(bearish, 102);   // previous day closed up → shorts blocked
  assert.strictEqual(CRT.context(up).htf.at(-1).prevDayDir, 1);
  assert.strictEqual(CRT.detect(up, up.length - 1, { ...P, bias: 'prevDay' }, CRT.context(up)), null);
  const down = nySeries(bearish, 98);  // previous day closed down → shorts allowed
  assert.ok(CRT.detect(down, down.length - 1, { ...P, bias: 'prevDay' }, CRT.context(down)));
});

test('premium/discount: shorts only above the previous day midpoint', () => {
  const c = nySeries(bearish);
  const ctx = CRT.context(c);
  assert.strictEqual(ctx.htf.at(-1).prevDayMid, 100);
  assert.ok(CRT.detect(c, c.length - 1, { ...P, zone: 'pd' }, ctx));             // entry 104 > 100
  const low = nySeries([bearish[0], { ...bearish[1], close: 99.5 }]);
  assert.strictEqual(CRT.detect(low, low.length - 1, { ...P, zone: 'pd' }, CRT.context(low)), null);
});
