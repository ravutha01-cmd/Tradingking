/* Technical indicators. Pure functions over arrays of numbers / candles.
 * Works in the browser (window.Indicators) and in Node (module.exports). */
(function (root) {
  'use strict';

  function sma(values, period) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  function ema(values, period) {
    const out = new Array(values.length).fill(null);
    if (values.length < period) return out;
    const k = 2 / (period + 1);
    let prev = 0;
    for (let i = 0; i < period; i++) prev += values[i];
    prev /= period;
    out[period - 1] = prev;
    for (let i = period; i < values.length; i++) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  // Wilder's RSI
  function rsi(values, period = 14) {
    const out = new Array(values.length).fill(null);
    if (values.length <= period) return out;
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const d = values[i] - values[i - 1];
      if (d >= 0) gain += d; else loss -= d;
    }
    gain /= period; loss /= period;
    out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    for (let i = period + 1; i < values.length; i++) {
      const d = values[i] - values[i - 1];
      gain = (gain * (period - 1) + Math.max(d, 0)) / period;
      loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
    return out;
  }

  function macd(values, fast = 12, slow = 26, signal = 9) {
    const ef = ema(values, fast);
    const es = ema(values, slow);
    const line = values.map((_, i) => (ef[i] == null || es[i] == null ? null : ef[i] - es[i]));
    const start = line.findIndex((v) => v != null);
    const sig = new Array(values.length).fill(null);
    if (start >= 0) {
      const sub = ema(line.slice(start), signal);
      sub.forEach((v, j) => { sig[start + j] = v; });
    }
    const hist = line.map((v, i) => (v == null || sig[i] == null ? null : v - sig[i]));
    return { line, signal: sig, hist };
  }

  // Wilder's ATR over candles {high, low, close}
  function atr(candles, period = 14) {
    const out = new Array(candles.length).fill(null);
    if (candles.length <= period) return out;
    const tr = candles.map((c, i) => {
      if (i === 0) return c.high - c.low;
      const pc = candles[i - 1].close;
      return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
    });
    let prev = 0;
    for (let i = 1; i <= period; i++) prev += tr[i];
    prev /= period;
    out[period] = prev;
    for (let i = period + 1; i < candles.length; i++) {
      prev = (prev * (period - 1) + tr[i]) / period;
      out[i] = prev;
    }
    return out;
  }

  function bollinger(values, period = 20, mult = 2) {
    const mid = sma(values, period);
    const upper = [], lower = [];
    for (let i = 0; i < values.length; i++) {
      if (mid[i] == null) { upper.push(null); lower.push(null); continue; }
      let v = 0;
      for (let j = i - period + 1; j <= i; j++) v += (values[j] - mid[i]) ** 2;
      const sd = Math.sqrt(v / period);
      upper.push(mid[i] + mult * sd);
      lower.push(mid[i] - mult * sd);
    }
    return { mid, upper, lower };
  }

  const api = { sma, ema, rsi, macd, atr, bollinger };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Indicators = api;
})(typeof window !== 'undefined' ? window : globalThis);
