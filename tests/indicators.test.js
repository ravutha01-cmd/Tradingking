const test = require('node:test');
const assert = require('node:assert');
const I = require('../js/indicators.js');
const S = require('../js/signals.js');

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('sma and ema', () => {
  const v = [1, 2, 3, 4, 5];
  assert.deepStrictEqual(I.sma(v, 3), [null, null, 2, 3, 4]);
  const e = I.ema(v, 3);
  close(e[2], 2); close(e[3], 3); close(e[4], 4);
});

test('rsi is 100 on a straight rise and 0 on a straight fall', () => {
  const up = Array.from({ length: 30 }, (_, i) => i);
  assert.strictEqual(I.rsi(up, 14).at(-1), 100);
  close(I.rsi(up.slice().reverse(), 14).at(-1), 0);
});

test('atr of constant-range candles equals the range', () => {
  const c = Array.from({ length: 30 }, () => ({ high: 11, low: 9, close: 10 }));
  close(I.atr(c, 14).at(-1), 2);
});

function trend(slope, n = 300) {
  return Array.from({ length: n }, (_, i) => {
    const base = 2000 + i * slope + Math.sin(i / 3) * 2;
    return { time: i * 60000, open: base, high: base + 3, low: base - 3, close: base, volume: 1, closed: true };
  });
}

test('uptrend produces a buy with stop below entry', () => {
  const s = S.analyze(trend(1));
  assert.match(s.action, /BUY/);
  assert.ok(s.plan.stopLoss < s.plan.entry && s.plan.tp2 > s.plan.tp1);
});

test('downtrend produces a sell with stop above entry', () => {
  const s = S.analyze(trend(-1));
  assert.match(s.action, /SELL/);
  assert.ok(s.plan.stopLoss > s.plan.entry && s.plan.tp2 < s.plan.tp1);
});

test('too little data waits', () => {
  assert.strictEqual(S.analyze(trend(1, 50)).action, 'WAIT');
});
