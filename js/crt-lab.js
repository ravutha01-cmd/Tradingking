(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const fmt = (v, d = 2) => (v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pct = (v) => (v * 100).toFixed(1) + '%';
  const sR = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`;
  const date = (t) => new Date(t).toLocaleString([], { year: '2-digit', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const day = (t) => new Date(t).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });

  const KEY = 'tradingking.crt';
  const st = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* storage unavailable */ } };
  st.journal = st.journal || [];
  st.recordingSince = st.recordingSince || Date.now();
  save();

  const BUILT_IN = window.CRT_TRAINED || null;
  const active = () => st.params || (BUILT_IN && BUILT_IN.params) || CRT.DEFAULT_PARAMS;
  const cost = () => +$('cost').value || 0;
  let candles = [];
  let lastTrain = null;

  // ---------- Live ----------
  function setStatus(s) { $('status').className = 'status ' + s; $('status').querySelector('b').textContent = s; }

  function renderLive() {
    if (candles.length < 3) return;
    $('price').textContent = fmt(candles[candles.length - 1].close);
    $('paramsLabel').textContent = st.params ? 'your trained settings' : BUILT_IN ? 'built-in trained settings' : 'default settings';
    const cur = CRT.current(candles, active());
    const s = cur.setup;
    const live = s && s.result.outcome === 'open';
    const card = $('crtAction').closest('.card');
    card.classList.toggle('buy', !!live && s.dir === 1);
    card.classList.toggle('sell', !!live && s.dir === -1);
    $('crtAction').textContent = live ? (s.dir === 1 ? 'BULLISH CRT · BUY' : 'BEARISH CRT · SELL') : 'NO ACTIVE SETUP';
    $('crtAction').style.color = live ? '' : 'var(--neutral)';
    if (s) {
      $('crtNote').textContent = live
        ? `Setup confirmed on the 4H candle closed ${date(s.time + 4 * 3600e3)} (${s.barsAgo ? s.barsAgo + ' candle(s) ago' : 'latest candle'}).`
        : `Last setup ${date(s.time)} (${s.side}) has finished: ${s.result.outcome} (${sR(s.result.r)}).`;
      $('crtPlan').innerHTML = `
        <tr><td>Direction</td><td><span class="tag ${s.dir === 1 ? 'buy' : 'sell'}">${s.side}</span></td></tr>
        <tr><td>Entry (C2 close)</td><td>${fmt(s.entry)}</td></tr>
        <tr class="sl"><td>Stop loss</td><td>${fmt(s.sl)}</td></tr>
        <tr class="tp"><td>Target</td><td>${fmt(s.tp)}</td></tr>
        <tr><td>Reward : risk</td><td>${s.rr.toFixed(2)}</td></tr>
        <tr><td>C1 range</td><td>${fmt(s.c1Low)} – ${fmt(s.c1High)}</td></tr>`;
    } else {
      $('crtNote').textContent = 'No CRT setup matching the active settings in the last 3 closed 4H candles.';
      $('crtPlan').innerHTML = '';
    }
    const w = cur.watch, f = cur.forming;
    const p = active();
    const sweptHigh = f && f.high > w.high, sweptLow = f && f.low < w.low;
    $('crtWatch').innerHTML = `
      <tr><td>C1 opened</td><td>${date(w.time)}</td></tr>
      <tr><td>C1 high</td><td>${fmt(w.high)}</td></tr>
      <tr><td>C1 low</td><td>${fmt(w.low)}</td></tr>
      <tr><td>Range / ATR</td><td>${fmt(w.range)} / ${fmt(w.atr)} ${w.range >= p.minRangeAtr * w.atr ? '✓' : `(needs ≥ ${p.minRangeAtr}× ATR)`}</td></tr>
      ${f ? `<tr><td>Forming candle</td><td>H ${fmt(f.high)} · L ${fmt(f.low)} · C ${fmt(f.close)}</td></tr>
      <tr><td>Sweep so far</td><td>${sweptHigh ? '<span class="tag sell">high swept</span> ' : ''}${sweptLow ? '<span class="tag buy">low swept</span>' : ''}${!sweptHigh && !sweptLow ? 'none yet' : ''}</td></tr>
      <tr><td>Candle closes</td><td>${date(f.time + 4 * 3600e3)}</td></tr>` : ''}`;
  }

  function renderData() {
    const closed = candles.filter((c) => c.closed);
    $('dataInfo').innerHTML = closed.length ? `
      <tr><td>Candles recorded</td><td>${closed.length.toLocaleString()}</td></tr>
      <tr><td>From</td><td>${day(closed[0].time)}</td></tr>
      <tr><td>To</td><td>${date(closed[closed.length - 1].time)}</td></tr>
      <tr><td>Last update</td><td>${new Date().toLocaleTimeString()}</td></tr>` : '<tr><td>No data yet</td></tr>';
  }

  // ---------- Journal ----------
  function renderJournal() {
    st.journal = CRT.updateJournal(st.journal, candles, active(), st.recordingSince, cost());
    save();
    const s = CRT.stats(st.journal.slice().reverse());
    $('journalTiles').innerHTML = tiles([
      ['Recording since', day(st.recordingSince)], ['Signals', st.journal.length], ['Closed', s.trades],
      ['Win rate', s.trades ? pct(s.winRate) : '—'], ['Total', s.trades ? sR(s.totalR) : '—'],
    ]);
    $('journal').innerHTML = st.journal.length
      ? '<tr><th>Signal candle</th><th>Side</th><th>Entry</th><th>Stop</th><th>Target</th><th>Result</th></tr>' + st.journal.map((e) => `
        <tr><td>${date(e.time)}</td><td><span class="tag ${e.side === 'LONG' ? 'buy' : 'sell'}">${e.side}</span></td>
        <td>${fmt(e.entry)}</td><td>${fmt(e.sl)}</td><td>${fmt(e.tp)}</td>
        <td>${e.outcome === 'open' ? 'open' : `${e.outcome} ${sR(e.r)}`}</td></tr>`).join('')
      : '<tr><td>No live CRT signals yet. Keep this page open (or come back later) — new 4H setups are recorded automatically.</td></tr>';
  }

  // ---------- Backtest & chart ----------
  function tiles(items) {
    return items.map(([k, v, cls]) => `<div class="tile"><span>${k}</span><b class="${cls || ''}">${v}</b></div>`).join('');
  }

  function statTiles(s) {
    return tiles([
      ['Trades', s.trades], ['Win rate', pct(s.winRate)],
      ['Avg per trade', sR(s.expectancy), s.expectancy >= 0 ? 'up' : 'down'],
      ['Total', sR(s.totalR), s.totalR >= 0 ? 'up' : 'down'],
      ['Profit factor', fmt(s.profitFactor)], ['Max drawdown', `${s.maxDD.toFixed(1)}R`],
    ]);
  }

  function renderBacktest() {
    const closed = candles.filter((c) => c.closed);
    if (closed.length < 300) return;
    const p = active();
    const bt = CRT.backtest(closed, p, { cost: cost() });
    $('tiles').innerHTML = statTiles(bt.stats);
    const split = (st.params ? st.splitTime : BUILT_IN && BUILT_IN.splitTime) || null;
    drawEquity($('equity'), bt.stats.equity, split);
    $('activeParams').innerHTML = paramRows(p);
    $('trades').innerHTML = '<tr><th>Signal candle</th><th>Side</th><th>Entry</th><th>Stop</th><th>Target</th><th>Result</th></tr>' +
      bt.trades.slice(-30).reverse().map((t) => `<tr><td>${date(t.time)}</td><td><span class="tag ${t.dir === 1 ? 'buy' : 'sell'}">${t.side}</span></td>
      <td>${fmt(t.entry)}</td><td>${fmt(t.sl)}</td><td>${fmt(t.tp)}</td><td>${t.outcome} ${t.outcome === 'open' ? '' : sR(t.r)}</td></tr>`).join('');
  }

  const LABELS = {
    minRangeAtr: ['C1 range ≥', (v) => `${v}× ATR`], maxSweep: ['Max sweep beyond C1', (v) => `${v * 100}% of range`],
    closeDepth: ['C2 closes inside by ≥', (v) => `${v * 100}% of range`], trend: ['Trend filter', (v) => (v === 'none' ? 'off' : `with ${v.toUpperCase()}`)],
    target: ['Target', (v) => (v === 'mid' ? '50% of C1' : 'opposite side of C1')], slBufferAtr: ['Stop buffer', (v) => `${v}× ATR beyond C2 wick`],
    minRR: ['Min reward : risk', (v) => v], maxBars: ['Max holding time', (v) => `${v} candles (${v * 4}h)`],
    skipWeekend: ['Skip weekend candles', (v) => (v ? 'yes' : 'no')],
  };
  const paramRows = (p) => Object.entries(LABELS).map(([k, [l, f]]) => `<tr><td>${l}</td><td>${f(p[k])}</td></tr>`).join('');
  const paramShort = (p) => `range≥${p.minRangeAtr}ATR · sweep≤${p.maxSweep} · close≥${p.closeDepth} · ${p.trend} · ${p.target} · SL+${p.slBufferAtr}ATR · RR≥${p.minRR} · ${p.maxBars} bars${p.skipWeekend ? ' · no wkend' : ''}`;

  // Single-series equity curve (cumulative R) with hover crosshair + tooltip.
  function drawEquity(el, pts, splitTime) {
    if (!pts.length) { el.innerHTML = '<p class="hint">No trades.</p>'; return; }
    const W = el.clientWidth || 800, H = 260, m = { l: 48, r: 12, t: 12, b: 26 };
    const t0 = pts[0].time, t1 = pts[pts.length - 1].time;
    const ys = pts.map((p) => p.equity).concat(0);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const pad = (y1 - y0) * 0.08 || 1;
    const X = (t) => m.l + ((t - t0) / (t1 - t0 || 1)) * (W - m.l - m.r);
    const Y = (v) => m.t + (1 - (v - (y0 - pad)) / (y1 - y0 + 2 * pad)) * (H - m.t - m.b);
    const step = niceStep((y1 - y0 + 2 * pad) / 4);
    let grid = '';
    for (let v = Math.ceil((y0 - pad) / step) * step; v <= y1 + pad; v += step) {
      grid += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" class="${Math.abs(v) < 1e-9 ? 'zero' : 'grid'}"/>
        <text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${Math.round(v)}R</text>`;
    }
    let xl = '';
    for (let y = new Date(t0).getUTCFullYear() + 1; y <= new Date(t1).getUTCFullYear(); y++) {
      const t = Date.UTC(y, 0, 1);
      xl += `<text x="${X(t)}" y="${H - 8}" text-anchor="middle">${y}</text>`;
    }
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.time).toFixed(1)},${Y(p.equity).toFixed(1)}`).join('');
    const split = splitTime && splitTime > t0 && splitTime < t1
      ? `<line x1="${X(splitTime)}" x2="${X(splitTime)}" y1="${m.t}" y2="${H - m.b}" class="split"/>
         <text x="${X(splitTime) + 6}" y="${m.t + 12}" class="split-label">test period →</text>
         <text x="${X(splitTime) - 6}" y="${m.t + 12}" text-anchor="end" class="split-label">← training</text>` : '';
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Equity curve in R">
      ${grid}${xl}${split}<path d="${path}" class="line"/>
      <line class="cross" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/><circle class="dot" r="4" visibility="hidden"/>
      <rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/></svg>
      <div class="tip" hidden></div>`;
    const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), cross = svg.querySelector('.cross'), dot = svg.querySelector('.dot');
    svg.addEventListener('pointermove', (ev) => {
      const r = svg.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * W;
      const t = t0 + ((x - m.l) / (W - m.l - m.r)) * (t1 - t0);
      let i = pts.findIndex((p) => p.time >= t); if (i < 0) i = pts.length - 1;
      const p = pts[i];
      cross.setAttribute('x1', X(p.time)); cross.setAttribute('x2', X(p.time)); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', X(p.time)); dot.setAttribute('cy', Y(p.equity)); dot.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.innerHTML = `<b>${sR(p.equity)}</b> after trade ${i + 1}<br>${day(p.time)}`;
      const left = (X(p.time) / W) * r.width;
      tip.style.left = `${Math.min(left + 12, r.width - 150)}px`;
      tip.style.top = `${(Y(p.equity) / H) * r.height - 10}px`;
    });
    svg.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); });
  }
  function niceStep(raw) {
    const p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  }

  // ---------- Training ----------
  function verdictHtml(res) {
    if (!res.best) return '<div class="verdict bad">No settings produced enough trades. Lower "Min. trades" or record more data.</div>';
    const t = res.best.test;
    const good = t.trades >= 20 && t.expectancy > 0.05 && t.profitFactor > 1.1;
    const flat = t.expectancy > -0.05 && !good;
    const cls = good ? 'good' : flat ? 'warn' : 'bad';
    const msg = good
      ? `The trained settings stayed profitable on the unseen test period (${sR(t.expectancy)} per trade over ${t.trades} trades). This is encouraging but not proof: forward-test them in the journal before risking money.`
      : flat
        ? `The trained settings were about break-even on the unseen test period (${sR(t.expectancy)} per trade over ${t.trades} trades). The training result did not carry forward — treat these signals as unproven.`
        : `The trained settings lost money on the unseen test period (${sR(t.expectancy)} per trade over ${t.trades} trades). The training result looks like overfitting — do not trade these signals as they are.`;
    return `<div class="verdict ${cls}"><b>${good ? '✅ Passed' : flat ? '⚠️ Not proven' : '❌ Failed'} out-of-sample test.</b> ${msg}
      <br><small>${res.tested.toLocaleString()} combinations tried · ${res.robustCount} were consistently profitable across the training slices · cost $${res.cost}/trade.</small></div>`;
  }

  function renderTrainResults(res) {
    $('verdict').innerHTML = verdictHtml(res);
    if (!res.best) { $('trainResults').innerHTML = ''; return; }
    const b = res.best;
    const row = (name, s) => `<tr><td>${name}</td><td>${s.trades}</td><td>${pct(s.winRate)}</td><td class="${s.expectancy >= 0 ? 'up' : 'down'}">${sR(s.expectancy)}</td><td>${sR(s.totalR)}</td><td>${fmt(s.profitFactor)}</td><td>${s.maxDD.toFixed(1)}R</td></tr>`;
    $('trainResults').innerHTML = `
      <div class="two">
        <div><h3>Best settings</h3><table class="plan">${paramRows(b.params)}</table>
          ${res.fromBuiltIn ? '' : '<div class="buttons"><button id="btnUse" class="primary">Use these settings for live signals</button></div>'}</div>
        <div><h3>Results</h3><div class="table-scroll"><table class="history">
          <tr><th>Period</th><th>Trades</th><th>Win</th><th>Avg</th><th>Total</th><th>PF</th><th>Max DD</th></tr>
          ${row(`Training (to ${day(res.splitTime)})`, b.train)}${row('Test (unseen)', b.test)}</table></div></div>
      </div>
      <h3>Top 10 by training score</h3>
      <div class="table-scroll"><table class="history">
        <tr><th>#</th><th>Settings</th><th>Train avg</th><th>Train trades</th><th>Test avg</th><th>Test trades</th></tr>
        ${res.top.map((r, i) => `<tr><td>${i + 1}</td><td class="mono">${paramShort(r.params)}</td>
          <td class="${r.train.expectancy >= 0 ? 'up' : 'down'}">${sR(r.train.expectancy)}</td><td>${r.train.trades}</td>
          <td class="${r.test.expectancy >= 0 ? 'up' : 'down'}">${sR(r.test.expectancy)}</td><td>${r.test.trades}</td></tr>`).join('')}
      </table></div>`;
    const use = $('btnUse');
    if (use) use.addEventListener('click', () => {
      st.params = b.params; st.splitTime = res.splitTime; save();
      use.textContent = 'Active ✓'; use.disabled = true;
      refreshAll();
    });
  }

  async function train() {
    const closed = candles.filter((c) => c.closed);
    if (closed.length < 1000) { $('verdict').innerHTML = '<div class="verdict warn">Record more data first.</div>'; return; }
    const btn = $('btnTrain'), bar = $('progress');
    btn.disabled = true; bar.hidden = false;
    const t0 = performance.now();
    lastTrain = await CRT.optimize(closed, {
      split: +$('split').value, cost: cost(), minTrades: +$('minTrades').value || 40,
      onProgress: (f) => { bar.firstElementChild.style.width = `${f * 100}%`; btn.textContent = `Training… ${Math.round(f * 100)}%`; },
    });
    btn.disabled = false; bar.hidden = true;
    btn.textContent = `Train again (${((performance.now() - t0) / 1000).toFixed(0)}s)`;
    renderTrainResults(lastTrain);
  }

  // The built-in result (from scripts/train-crt.js) is shown until the user trains.
  function showBuiltIn() {
    if (!BUILT_IN) return;
    renderTrainResults({
      fromBuiltIn: true, best: { params: BUILT_IN.params, train: BUILT_IN.train, test: BUILT_IN.test },
      top: [{ params: BUILT_IN.params, train: BUILT_IN.train, test: BUILT_IN.test }],
      tested: BUILT_IN.combinations, robustCount: BUILT_IN.robustCount, cost: BUILT_IN.cost, splitTime: BUILT_IN.splitTime,
    });
    $('trainResults').insertAdjacentHTML('afterbegin', `<p class="hint">Showing the built-in training run (${day(BUILT_IN.generatedAt)}, ${BUILT_IN.candles.toLocaleString()} candles). Press <b>Train</b> to retrain on your recorded data.</p>`);
  }

  // ---------- Data sync ----------
  async function sync() {
    setStatus('loading');
    try {
      const res = await History.sync('4h', (t) => { $('dataInfo').innerHTML = `<tr><td>Downloading… ${day(t)}</td></tr>`; });
      candles = res.candles;
      setStatus(res.saved ? 'live' : 'live (not saved)');
      refreshAll();
    } catch (e) {
      candles = History.load('4h');
      setStatus('error');
      $('crtNote').textContent = `Could not reach the data feed: ${e.message}`;
      if (candles.length) refreshAll();
    }
  }

  function refreshAll() { renderData(); renderLive(); renderBacktest(); renderJournal(); }

  // ---------- Init ----------
  $('btnSync').addEventListener('click', sync);
  $('btnTrain').addEventListener('click', train);
  $('btnCsv').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([History.toCSV(candles)], { type: 'text/csv' }));
    a.download = 'xauusd-paxg-4h.csv'; a.click();
  });
  $('btnClearData').addEventListener('click', () => { if (confirm('Delete recorded candles from this browser?')) { History.clear('4h'); candles = []; sync(); } });
  $('btnClearJournal').addEventListener('click', () => { st.journal = []; st.recordingSince = Date.now(); save(); renderJournal(); });
  $('btnReset').addEventListener('click', () => { delete st.params; delete st.splitTime; save(); refreshAll(); });
  $('cost').addEventListener('change', () => { renderBacktest(); });
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderBacktest, 200); });

  candles = History.load('4h');
  if (candles.length) refreshAll();
  showBuiltIn();
  sync();
  setInterval(sync, 60000);
})();
