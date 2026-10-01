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
const P = { ...CRT.DEFAULT_PARAMS, minRangeAtr: 1, maxSweep: 0.5, closeDepth: 0, trend: 'none', target: 'opposite', slBufferAtr: 0, minRR: 0, maxBars: 6, skipWeekend: false };

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
  const res = await CRT.optimize(c, { minTrades: 5, grid: { ...CRT.GRID, maxBars: [6], slBufferAtr: [0], skipWeekend: [false] } });
  assert.ok(res.tested > 0);
  if (res.best) assert.ok(res.best.test && typeof res.best.test.expectancy === 'number');
});
