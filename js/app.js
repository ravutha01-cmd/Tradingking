(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const fmt = (v, d = 2) => (v == null || isNaN(v) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));

  const TV_INTERVAL = { '1m': '1', '5m': '5', '15m': '15', '1h': '60', '4h': '240', '1d': 'D' };
  const TA_INTERVAL = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1D' };
  const MTF_FRAMES = ['5m', '15m', '1h', '4h', '1d'];
  const STORE = 'tradingking.v1';

  const store = (() => {
    try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
  })();
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(store)); } catch { /* storage unavailable */ } };
  store.history = store.history || [];

  const state = { feed: null, interval: store.interval || '15m', candles: [], unsubscribe: null, lastKey: null, renderPending: false, mtfTimer: null };

  // ---------- TradingView widgets ----------
  function embedWidget(container, src, config) {
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'tradingview-widget-container';
    wrap.style.height = '100%';
    const inner = document.createElement('div');
    inner.className = 'tradingview-widget-container__widget';
    inner.style.height = '100%';
    wrap.appendChild(inner);
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.textContent = JSON.stringify(config);
    wrap.appendChild(s);
    container.appendChild(wrap);
  }

  function loadTradingView() {
    embedWidget($('tvChart'), 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js', {
      autosize: true, symbol: 'OANDA:XAUUSD', interval: TV_INTERVAL[state.interval], timezone: 'Etc/UTC',
      theme: 'dark', style: '1', locale: 'en', allow_symbol_change: true, hide_side_toolbar: false,
      studies: ['STD;EMA', 'STD;RSI', 'STD;MACD'], support_host: 'https://www.tradingview.com',
    });
    embedWidget($('tvTa'), 'https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js', {
      interval: TA_INTERVAL[state.interval], width: '100%', height: '100%', isTransparent: true,
      symbol: 'OANDA:XAUUSD', showIntervalTabs: true, displayMode: 'single', locale: 'en', colorTheme: 'dark',
    });
  }

  // ---------- Status / price ----------
  function setStatus(s) {
    const el = $('status');
    el.className = 'status ' + s;
    el.querySelector('b').textContent = s;
  }

  async function updateChange() {
    if (state.feed.id !== 'binance') { $('change').textContent = ''; return; }
    try {
      const r = await fetch('https://data-api.binance.vision/api/v3/ticker/24hr?symbol=PAXGUSDT');
      const t = await r.json();
      const pct = +t.priceChangePercent;
      const el = $('change');
      el.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% 24h`;
      el.className = 'change ' + (pct >= 0 ? 'up' : 'down');
    } catch { /* non-critical */ }
  }

  // ---------- Rendering ----------
  const cls = (action) => (action.includes('BUY') ? 'buy' : action.includes('SELL') ? 'sell' : 'neutral');

  function renderSignal(sig) {
    const card = $('signalCard');
    card.className = 'card signal-card ' + (sig.ready ? cls(sig.action) : '');
    $('signalTf').textContent = state.interval.toUpperCase();
    $('action').textContent = sig.action;
    if (!sig.ready) { $('confidence').textContent = sig.reasons[0]; return; }

    $('meterBar').style.left = `calc(${((sig.score + sig.maxScore) / (2 * sig.maxScore)) * 100}% - 2px)`;
    $('confidence').textContent = `Score ${sig.score > 0 ? '+' : ''}${sig.score} / ${sig.maxScore} · confidence ${sig.confidence}%`;

    const p = sig.plan;
    $('plan').innerHTML = p ? `
      <tr><td>Direction</td><td><span class="tag ${cls(sig.action)}">${p.direction}</span></td></tr>
      <tr><td>Entry</td><td>${fmt(p.entry)}</td></tr>
      <tr class="sl"><td>Stop loss</td><td>${fmt(p.stopLoss)}</td></tr>
      <tr class="tp"><td>TP1 (1R)</td><td>${fmt(p.tp1)}</td></tr>
      <tr class="tp"><td>TP2 (2R)</td><td>${fmt(p.tp2)}</td></tr>
      <tr class="tp"><td>TP3 (3R)</td><td>${fmt(p.tp3)}</td></tr>
      <tr><td>Risk / oz</td><td>$${fmt(p.risk)}</td></tr>`
      : '<tr><td>No trade — wait for confirmation</td></tr>';

    $('reasons').innerHTML = sig.reasons
      .map((r) => `<li class="${r.pts > 0 ? 'pos' : r.pts < 0 ? 'neg' : 'zero'}">${r.text}</li>`).join('');
    $('updated').textContent = `Updated ${new Date().toLocaleTimeString()} · ${state.feed.label}`;

    const i = sig.indicators;
    $('indicators').innerHTML = [
      ['Price', fmt(i.price)], ['EMA 9', fmt(i.ema9)], ['EMA 21', fmt(i.ema21)], ['EMA 50', fmt(i.ema50)],
      ['EMA 200', fmt(i.ema200)], ['RSI 14', fmt(i.rsi, 1)], ['MACD', fmt(i.macd)], ['MACD signal', fmt(i.macdSignal)],
      ['MACD hist', fmt(i.macdHist)], ['ATR 14', fmt(i.atr)], ['BB upper', fmt(i.bbUpper)], ['BB lower', fmt(i.bbLower)],
    ].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  }

  function renderHistory() {
    const rows = store.history.slice(0, 50);
    $('history').innerHTML = rows.length
      ? '<tr><th>Time</th><th>TF</th><th>Signal</th><th>Entry</th><th>SL</th><th>TP2</th></tr>' + rows.map((h) => `
        <tr><td>${new Date(h.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
        <td>${h.tf}</td><td><span class="tag ${cls(h.action)}">${h.action}</span></td>
        <td>${fmt(h.entry)}</td><td>${fmt(h.sl)}</td><td>${fmt(h.tp2)}</td></tr>`).join('')
      : '<tr><td>No signals recorded yet. New BUY/SELL signals are logged when a candle closes.</td></tr>';
  }

  // ---------- Signal lifecycle ----------
  function evaluate() {
    state.renderPending = false;
    const sig = Signals.analyze(state.candles, { slAtr: +$('slAtr').value || 1.5 });
    renderSignal(sig);
    const price = state.candles.length ? state.candles[state.candles.length - 1].close : null;
    $('price').textContent = fmt(price);
    document.title = `${fmt(price)} · ${sig.action} · XAUUSD`;
    return sig;
  }

  function scheduleRender() {
    if (state.renderPending) return;
    state.renderPending = true;
    requestAnimationFrame(evaluate);
  }

  // Log a signal only on candle close, when the direction changes.
  function onCandleClosed() {
    const closed = state.candles.filter((c) => c.closed);
    const sig = Signals.analyze(closed, { slAtr: +$('slAtr').value || 1.5 });
    if (!sig.ready) return;
    const dir = cls(sig.action);
    const key = `${state.feed.id}:${state.interval}`;
    store.lastDir = store.lastDir || {};
    if (store.lastDir[key] === dir) return;
    store.lastDir[key] = dir;
    if (dir !== 'neutral' && sig.plan) {
      store.history.unshift({
        time: Date.now(), tf: state.interval, action: sig.action,
        entry: sig.plan.entry, sl: sig.plan.stopLoss, tp2: sig.plan.tp2,
      });
      store.history = store.history.slice(0, 200);
      renderHistory();
      alertUser(sig);
    }
    save();
  }

  function alertUser(sig) {
    if (!$('notify').checked) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      o.frequency.value = sig.action.includes('BUY') ? 880 : 440;
      o.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.25);
    } catch { /* audio unavailable */ }
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(`XAUUSD ${sig.action} (${state.interval})`, {
        body: `Entry ${fmt(sig.plan.entry)} · SL ${fmt(sig.plan.stopLoss)} · TP ${fmt(sig.plan.tp1)} / ${fmt(sig.plan.tp2)}`,
      });
    }
  }

  function onCandle(c) {
    const arr = state.candles;
    const lastC = arr[arr.length - 1];
    if (lastC && lastC.time === c.time) arr[arr.length - 1] = c;
    else if (!lastC || c.time > lastC.time) {
      if (lastC && !lastC.closed) { lastC.closed = true; onCandleClosed(); }
      arr.push(c);
      if (arr.length > 1000) arr.shift();
    } else return; // stale
    if (c.closed) onCandleClosed();
    scheduleRender();
  }

  // ---------- Multi-timeframe ----------
  async function updateMtf() {
    if (state.feed.id !== 'binance') {
      $('mtf').innerHTML = '<tr><td>Multi-timeframe scan uses the Binance feed (saves Twelve Data API credits).</td></tr>';
      return;
    }
    const rows = await Promise.all(MTF_FRAMES.map(async (tf) => {
      try {
        const candles = await state.feed.fetchCandles(tf, 500);
        const sig = Signals.analyze(candles, { slAtr: +$('slAtr').value || 1.5 });
        return { tf, sig };
      } catch { return { tf, sig: null }; }
    }));
    $('mtf').innerHTML = '<tr><th>TF</th><th>Signal</th><th>RSI</th><th>Score</th></tr>' + rows.map(({ tf, sig }) => sig && sig.ready
      ? `<tr><td>${tf.toUpperCase()}</td><td><span class="tag ${cls(sig.action)}">${sig.action}</span></td><td>${fmt(sig.indicators.rsi, 1)}</td><td>${sig.score > 0 ? '+' : ''}${sig.score}</td></tr>`
      : `<tr><td>${tf.toUpperCase()}</td><td>—</td><td></td><td></td></tr>`).join('');
  }

  // ---------- CRT 4H (settings come from the CRT Lab or the built-in training) ----------
  function crtParams() {
    try { const s = JSON.parse(localStorage.getItem('tradingking.crt')); if (s && s.version === 2 && s.params) return s.params; } catch { /* ignore */ }
    return (window.CRT_TRAINED && window.CRT_TRAINED.params) || CRT.DEFAULT_PARAMS;
  }

  // CRT runs on New York-aligned 4H candles built from the last ~4 months of 1H data.
  async function updateCrt() {
    try {
      const hourly = await History.fetchRange('1h', Date.now() - 3000 * 3600e3);
      renderCrt(Sessions.build4h(hourly));
    } catch (e) {
      $('crtMiniNote').textContent = `CRT data unavailable: ${e.message}`;
    }
  }

  function renderCrt(candles) {
    const p = crtParams();
    const { setup: s, watch: w, nyHour } = CRT.current(candles, p);
    const live = s && s.result.outcome === 'open';
    const el = $('crtMiniAction');
    el.textContent = live ? (s.dir === 1 ? 'BULLISH CRT · BUY' : 'BEARISH CRT · SELL') : 'NO ACTIVE SETUP';
    el.style.color = live ? (s.dir === 1 ? 'var(--buy)' : 'var(--sell)') : 'var(--neutral)';
    const sess = Sessions.SESSIONS[p.session || 'all'];
    $('crtMiniNote').textContent = live
      ? `Entry ${fmt(s.entry)} · R:R ${s.rr.toFixed(2)} · ${Sessions.sessionName(s.nyHour)}`
      : `Watching C1 range ${fmt(w.low)} – ${fmt(w.high)} · now ${Sessions.fmtHour(nyHour)}${sess.hours ? ` · filter: ${sess.label}` : ''}`;
    $('crtMiniPlan').innerHTML = live
      ? `<tr class="sl"><td>Stop loss</td><td>${fmt(s.sl)}</td></tr><tr class="tp"><td>Target</td><td>${fmt(s.tp)}</td></tr>`
      : '';
  }

  // ---------- Startup ----------
  async function start() {
    if (state.unsubscribe) state.unsubscribe();
    clearInterval(state.mtfTimer);
    state.feed = Feeds[$('feed').value];
    if (state.feed.id === 'twelvedata') state.feed.apiKey = $('apiKey').value.trim();
    state.candles = [];
    setStatus('connecting');
    $('action').textContent = 'WAIT';
    $('confidence').textContent = 'Loading market data…';
    $('plan').innerHTML = ''; $('reasons').innerHTML = '';
    try {
      state.candles = await state.feed.fetchCandles(state.interval, 500);
      const sig = evaluate();
      // Seed the last direction so a page reload does not re-log the current signal.
      store.lastDir = store.lastDir || {};
      const key = `${state.feed.id}:${state.interval}`;
      if (!(key in store.lastDir) && sig.ready) { store.lastDir[key] = cls(sig.action); save(); }
      state.unsubscribe = state.feed.subscribe(state.interval, onCandle, setStatus);
    } catch (e) {
      setStatus('error');
      $('confidence').textContent = e.message;
    }
    updateChange();
    updateMtf();
    state.mtfTimer = setInterval(() => { updateMtf(); updateChange(); }, 60000);
  }

  function init() {
    $('interval').value = state.interval;
    $('feed').value = store.feed || 'binance';
    $('apiKey').value = store.apiKey || '';
    $('slAtr').value = store.slAtr || 1.5;
    $('notify').checked = !!store.notify;
    $('keyWrap').hidden = $('feed').value !== 'twelvedata';

    $('interval').addEventListener('change', (e) => {
      state.interval = store.interval = e.target.value; save();
      loadTradingView(); start();
    });
    $('feed').addEventListener('change', (e) => {
      store.feed = e.target.value; save();
      $('keyWrap').hidden = e.target.value !== 'twelvedata';
      start();
    });
    $('apiKey').addEventListener('change', (e) => { store.apiKey = e.target.value.trim(); save(); start(); });
    $('slAtr').addEventListener('change', (e) => { store.slAtr = +e.target.value; save(); evaluate(); updateMtf(); });
    $('notify').addEventListener('change', (e) => {
      store.notify = e.target.checked; save();
      if (e.target.checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    });
    $('clearHistory').addEventListener('click', () => { store.history = []; save(); renderHistory(); });

    renderHistory();
    loadTradingView();
    start();
    updateCrt();
    setInterval(updateCrt, 5 * 60000);
  }

  init();
})();
