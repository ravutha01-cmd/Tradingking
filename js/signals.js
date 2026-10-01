/* Signal engine: scores trend + momentum conditions and builds a trade plan
 * (entry, stop loss, take profits) from ATR. Not financial advice. */
(function (root) {
  'use strict';
  const I = typeof module !== 'undefined' && module.exports ? require('./indicators.js') : root.Indicators;

  const MIN_CANDLES = 210; // EMA200 needs warm-up

  function last(arr, back = 0) { return arr[arr.length - 1 - back]; }

  function analyze(candles, opts = {}) {
    const slMult = opts.slAtr ?? 1.5;
    if (!candles || candles.length < MIN_CANDLES) {
      return { action: 'WAIT', score: 0, reasons: ['Not enough data yet'], ready: false };
    }
    const closes = candles.map((c) => c.close);
    const e9 = I.ema(closes, 9), e21 = I.ema(closes, 21), e50 = I.ema(closes, 50), e200 = I.ema(closes, 200);
    const r = I.rsi(closes, 14);
    const m = I.macd(closes);
    const a = I.atr(candles, 14);
    const bb = I.bollinger(closes, 20, 2);

    const price = last(closes);
    const ind = {
      price, ema9: last(e9), ema21: last(e21), ema50: last(e50), ema200: last(e200),
      rsi: last(r), macd: last(m.line), macdSignal: last(m.signal), macdHist: last(m.hist),
      atr: last(a), bbUpper: last(bb.upper), bbLower: last(bb.lower), bbMid: last(bb.mid),
    };

    const reasons = [];
    let score = 0;
    const add = (pts, text) => { score += pts; reasons.push({ pts, text }); };

    // 1. Long-term trend
    if (price > ind.ema200) add(1, 'Price above EMA200 (uptrend)');
    else add(-1, 'Price below EMA200 (downtrend)');

    // 2. Medium trend alignment
    if (ind.ema21 > ind.ema50) add(1, 'EMA21 above EMA50');
    else add(-1, 'EMA21 below EMA50');

    // 3. Fresh EMA9/21 crossover within the last 3 candles
    let cross = 0;
    for (let k = 0; k < 3; k++) {
      const now = e9[e9.length - 1 - k] - e21[e21.length - 1 - k];
      const prev = e9[e9.length - 2 - k] - e21[e21.length - 2 - k];
      if (prev <= 0 && now > 0) { cross = 1; break; }
      if (prev >= 0 && now < 0) { cross = -1; break; }
    }
    if (cross === 1) add(2, 'Bullish EMA9/21 crossover');
    else if (cross === -1) add(-2, 'Bearish EMA9/21 crossover');
    else if (ind.ema9 > ind.ema21) add(1, 'EMA9 above EMA21');
    else add(-1, 'EMA9 below EMA21');

    // 4. MACD momentum
    const histPrev = last(m.hist, 1);
    if (ind.macdHist > 0 && ind.macdHist >= histPrev) add(1, 'MACD histogram positive & rising');
    else if (ind.macdHist < 0 && ind.macdHist <= histPrev) add(-1, 'MACD histogram negative & falling');
    else reasons.push({ pts: 0, text: 'MACD momentum fading' });

    // 5. RSI
    if (ind.rsi >= 70) add(-1, `RSI overbought (${ind.rsi.toFixed(1)})`);
    else if (ind.rsi <= 30) add(1, `RSI oversold (${ind.rsi.toFixed(1)})`);
    else if (ind.rsi > 55) add(1, `RSI bullish (${ind.rsi.toFixed(1)})`);
    else if (ind.rsi < 45) add(-1, `RSI bearish (${ind.rsi.toFixed(1)})`);
    else reasons.push({ pts: 0, text: `RSI neutral (${ind.rsi.toFixed(1)})` });

    // 6. Bollinger extremes (mean reversion caution)
    if (price > ind.bbUpper) add(-1, 'Price above upper Bollinger band');
    else if (price < ind.bbLower) add(1, 'Price below lower Bollinger band');

    const maxScore = 7;
    let action = 'NEUTRAL';
    if (score >= 4) action = 'STRONG BUY';
    else if (score >= 2) action = 'BUY';
    else if (score <= -4) action = 'STRONG SELL';
    else if (score <= -2) action = 'SELL';

    let plan = null;
    const dir = action.includes('BUY') ? 1 : action.includes('SELL') ? -1 : 0;
    if (dir !== 0) {
      const risk = ind.atr * slMult;
      plan = {
        direction: dir === 1 ? 'LONG' : 'SHORT',
        entry: price,
        stopLoss: price - dir * risk,
        tp1: price + dir * risk,       // 1R
        tp2: price + dir * risk * 2,   // 2R
        tp3: price + dir * risk * 3,   // 3R
        risk,
      };
    }

    return {
      ready: true, action, score, maxScore,
      confidence: Math.round((Math.abs(score) / maxScore) * 100),
      reasons, indicators: ind, plan, time: last(candles).time,
    };
  }

  const api = { analyze, MIN_CANDLES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Signals = api;
})(typeof window !== 'undefined' ? window : globalThis);
