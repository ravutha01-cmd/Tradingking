(function () {
  'use strict';
  const D = window.INTRADAY;
  const $ = (id) => document.getElementById(id);
  const fmt = (v, d = 2) => (v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pct = (v, d = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`;
  const sR = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`;
  const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  const time = (t) => new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const nyTime = (t) => new Date(t + Sessions.nyOffset(t)).toISOString().slice(11, 16) + ' NY';
  const tag = (txt, kind) => `<span class="tag ${kind}">${txt}</span>`;
  const side = (dir) => tag(dir === 1 ? 'BUY' : 'SELL', dir === 1 ? 'buy' : 'sell');
  const tfName = (tf) => (tf === 60 ? '1H' : tf === 240 ? '4H' : tf + 'm');
  const legName = (l) => `${tfName(l.tf)} ${l.label}`;
  const filters = (p) => [p.htf && p.htf !== 'none' ? `only with the ${p.htf.toUpperCase()} trend` : 'no higher-timeframe filter',
    p.sess === 'ldnny' ? 'London + New York session only' : 'any session', p.eod ? 'closed by 4 PM NY' : 'may run overnight'].join(' · ');
  const exitRule = (l, dir) => (l.id === 'bbrev' ? `target: middle band · max ${l.params.maxBars} candles`
    : l.id === 'donchian' ? `exit on a close beyond the ${l.params.m}-candle ${dir === 1 ? 'low' : 'high'}`
    : l.id === 'pullback' ? `exit when RSI(${l.params.len}) ${dir === -1 ? '< ' + (100 - l.params.exit) : '> ' + l.params.exit} · max ${l.params.maxBars} candles` : 'see rules');
  const WHY = { signal: 'exit rule', stop: 'stopped', target: 'target', time: 'time limit', eod: '4 PM close', 'session end': '4 PM close' };

  const KEY = 'tradingking.signals5';
  const st = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* storage unavailable */ } };
  st.seen = st.seen || [];
  let firstLoad = true;

  function setStatus(s) { $('status').className = 'status ' + s; $('status').querySelector('b').textContent = s; }

  // ───────── Static: results, rules, chart ─────────
  function renderStatic() {
    const y = D.ytd, rec = D.record, Y = D.years;
    $('tiles').innerHTML = [
      ['Signals / day (2026)', y.perDay.toFixed(1)], ['Win rate (2026)', (y.winRate * 100).toFixed(0) + '%'],
      ['2026 return', pct(y.returnPct), cls(y.returnPct)], ['2026 max drawdown', y.maxDDPct.toFixed(1) + '%'],
      ['2023 → now (out-of-sample)', pct(rec.returnPct), cls(rec.returnPct)], ['Positive months', `${rec.positiveMonths}/${rec.months}`],
    ].map(([k, v, c]) => `<div class="tile"><span>${k}</span><b class="${c || ''}">${v}</b></div>`).join('');
    $('verdict').className = 'verdict ' + (y.returnPct > 0 ? 'good' : 'bad');
    $('verdict').innerHTML = `<b>Walk-forward tested.</b> Every January the rules are re-chosen using only earlier data, then traded for the year. The 2026 rules were chosen on Aug 2020 – Dec 2025 and made ${pct(y.returnPct)} in 2026 (${y.perDay.toFixed(1)} signals/day, ${D.riskPct}% risk per trade); every year 2023–2026 was positive.
      The edge per trade is small (${sR(y.avgR)} in 2026 after $${D.cost} costs), so a low-spread broker matters.`;
    $('years').innerHTML = '<tr><th>Year</th><th>Rules chosen on</th><th>Signals/day</th><th>Win rate</th><th>Return</th><th>Max DD</th><th>Positive months</th></tr>' +
      Object.entries(Y).map(([yr, v]) => `<tr${yr === '2026' ? ' class="sel"' : ''}><td><b>${yr}</b></td><td>Aug 2020 – Dec ${yr - 1}</td><td>${v.perDay.toFixed(1)}</td><td>${(v.winRate * 100).toFixed(0)}%</td>
        <td class="${cls(v.returnPct)}">${pct(v.returnPct)}</td><td>${v.maxDDPct.toFixed(1)}%</td><td>${v.positiveMonths}/${v.months}</td></tr>`).join('');
    $('methods').innerHTML = '<tr><th>Selection method</th><th>2023</th><th>2024</th><th>2025</th><th>2023–25</th><th>Max DD</th><th>Signals/day</th></tr>' +
      D.methods.map((m) => `<tr${m.name === D.chosenMethod ? ' class="sel"' : ''}><td class="mono">${m.name}</td>${[2023, 2024, 2025].map((yr) => `<td class="${cls(m.years[yr].returnPct)}">${pct(m.years[yr].returnPct)}</td>`).join('')}
        <td class="${cls(m.oos.returnPct)}">${pct(m.oos.returnPct)}</td><td>${m.oos.maxDDPct.toFixed(1)}%</td><td>${m.oos.perDay.toFixed(1)}</td></tr>`).join('') +
      '<tr><td colspan="7" class="mono">The highlighted method was picked on 2023–25 only (best return ÷ drawdown with 4–7 signals/day); 2026 was not used to choose it.</td></tr>';
    $('costs').innerHTML = '<tr><th>Cost per trade</th><th>Avg per trade</th><th>2023 → now</th></tr>' +
      D.costCurve.map((c) => `<tr${c.cost === D.cost ? ' class="sel"' : ''}><td>$${c.cost.toFixed(2)}</td><td class="${cls(c.avgR)}">${c.avgR >= 0 ? '+' : ''}${c.avgR.toFixed(3)}R</td><td class="${cls(c.returnPct)}">${pct(c.returnPct)}</td></tr>`).join('');
    $('legs').innerHTML = '<tr><th>Rule</th><th>How it trades</th><th>Signals/day (2026)</th><th>Avg on 2020–25</th><th>Avg in 2026</th></tr>' +
      D.legs.map((l) => `<tr><td><b>${legName(l)}</b></td><td class="mono">${l.rules.replace(/ \(mirror[^)]*\)|, sell a close above the upper band| \(sell a close below the [^)]*\)/g, '')} Both directions. ${filters(l.params)}.</td>
        <td>${l.ytd.perDay.toFixed(2)}</td><td class="${cls(l.train.avgR)}">${sR(l.train.avgR)}</td><td class="${cls(l.ytd.avgR)}">${sR(l.ytd.avgR)}</td></tr>`).join('');
    drawEquity();
  }

  // ───────── 2026 comparison and forward test ─────────
  function renderBench() {
    const B = window.BENCH;
    if (!B) return;
    const R = B.random, L23 = B.since2023;
    $('benchVerdict').className = 'verdict good';
    $('benchVerdict').innerHTML = `<b>Beats chance over the long run.</b> From 2023 to now the walk-forward rules made ${pct(L23.record.returnPct)} while 500 random traders with the same frequency, stops and costs made a median of ${pct(L23.random.p50)} — the best of 500 made ${pct(L23.random.best)}, so the rules beat all of them.
      2026 alone is a short, unusually kind year for random entries (median ${pct(R.p50)}); here the rules beat ${(R.beatReturn * 100).toFixed(0)}% of random traders.
      Four other walk-forward variants did better in 2026, but nobody could have known that on 1 January — the live rules were chosen on 2023–25 results only.`;
    $('bench').innerHTML = '<tr><th>#</th><th>Approach (Jan 1 → ' + new Date(B.to).toLocaleDateString() + ')</th><th>Signals/day</th><th>Return</th><th>Max DD</th><th>Return ÷ DD</th></tr>' +
      B.ranking.map((r, i) => `<tr${r.kind === 'chosen' ? ' class="sel"' : ''}><td>${i + 1}</td><td>${r.name}${r.note ? ` <small>· ${r.note}</small>` : ''}</td><td>${r.perDay ? r.perDay.toFixed(1) : '—'}</td>
        <td class="${cls(r.returnPct)}">${pct(r.returnPct)}</td><td>${r.maxDDPct.toFixed(1)}%</td><td class="${cls(r.ratio)}">${r.ratio.toFixed(2)}</td></tr>`).join('') +
      `<tr><td colspan="6" class="mono">Random traders (500): 2026 5th–95th percentile ${pct(R.p5)} … ${pct(R.p95)}. 2023 → now: ${pct(L23.random.p5)} … ${pct(L23.random.p95)} vs the rules' ${pct(L23.record.returnPct)}.</td></tr>`;
  }

  function renderForward() {
    const F = window.FORWARD;
    if (!F) { $('fwd').innerHTML = '<tr><td>No forward-test data yet.</td></tr>'; return; }
    const s = F.summary;
    $('fwdUpdated').textContent = `since ${F.started.slice(0, 10)} · updated ${new Date(s.updated).toLocaleString()}`;
    $('fwdTiles').innerHTML = [['Signals recorded', s.signals], ['Per day', s.perDay.toFixed(1)], ['Closed', s.closed], ['Win rate', s.winRate == null ? '—' : (s.winRate * 100).toFixed(0) + '%'],
      ['Total', s.closed ? sR(s.totalR) : '—', cls(s.totalR)], ['Return (0.25%/trade)', s.closed ? pct(s.returnPct, 2) : '—', cls(s.returnPct)]]
      .map(([k, v, c]) => `<div class="tile"><span>${k}</span><b class="${c || ''}">${v}</b></div>`).join('');
    $('fwd').innerHTML = '<tr><th>Entered</th><th>First recorded</th><th>Rule</th><th>Side</th><th>Entry</th><th>Stop</th><th>Result</th></tr>' +
      [...F.signals].reverse().map((x) => `<tr><td>${time(Date.parse(x.entryTime))}</td><td>${time(Date.parse(x.firstSeen))}</td><td>${x.rule}</td><td>${side(x.side === 'BUY' ? 1 : -1)}</td>
        <td>${fmt(x.entry)}</td><td>${fmt(x.stop)}</td><td>${x.status === 'open' ? tag('open', 'neutral') : `${WHY[x.why] || x.why} <span class="${cls(x.r)}">${sR(x.r)}</span>`}</td></tr>`).join('');
  }

  function drawEquity() {
    const el = $('equity'), a = D.curve;
    if (!a || !a.length) return;
    const W = el.clientWidth || 800, H = 240, m = { l: 46, r: 16, t: 14, b: 26 };
    const t0 = a[0][0], t1 = a.at(-1)[0];
    const vs = a.map((p) => p[1]), y0 = Math.min(100, ...vs) * 0.98, y1 = Math.max(...vs) * 1.02;
    const X = (t) => m.l + ((t - t0) / (t1 - t0)) * (W - m.l - m.r);
    const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);
    const step = [5, 10, 20, 25, 50].find((s) => (y1 - y0) / s <= 6) || 50;
    let grid = '';
    for (let v = Math.ceil(y0 / step) * step; v <= y1; v += step) grid += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" class="${v === 100 ? 'zero' : 'grid'}"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
    let xl = '';
    for (let yr = new Date(t0).getUTCFullYear() + 1; yr <= new Date(t1).getUTCFullYear(); yr++) xl += `<text x="${X(Date.UTC(yr, 0, 1))}" y="${H - 8}" text-anchor="middle">${yr}</text>`;
    let years = '';
    for (let yr = new Date(t0).getUTCFullYear() + 1; yr <= new Date(t1).getUTCFullYear(); yr++) years += `<line x1="${X(Date.UTC(yr, 0, 1))}" x2="${X(Date.UTC(yr, 0, 1))}" y1="${m.t}" y2="${H - m.b}" class="split"/>`;
    const path = a.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Growth of 100">
      ${grid}${xl}${years}
      <path d="${path}" class="s1"/><line class="cross" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/><circle class="dot" r="4" visibility="hidden" style="fill:#c08a1e"/>
      <rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/></svg><div class="tip" hidden></div>`;
    const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), cross = svg.querySelector('.cross'), dot = svg.querySelector('.dot');
    svg.addEventListener('pointermove', (ev) => {
      const r = svg.getBoundingClientRect();
      const t = t0 + ((((ev.clientX - r.left) / r.width) * W - m.l) / (W - m.l - m.r)) * (t1 - t0);
      let lo = 0, hi = a.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid][0] < t) lo = mid + 1; else hi = mid; }
      const p = a[lo];
      cross.setAttribute('x1', X(p[0])); cross.setAttribute('x2', X(p[0])); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', X(p[0])); dot.setAttribute('cy', Y(p[1])); dot.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.innerHTML = `<b>${p[1].toFixed(1)}</b><br>${new Date(p[0]).toLocaleDateString()}`;
      tip.style.left = `${Math.min((X(p[0]) / W) * r.width + 12, r.width - 120)}px`;
      tip.style.top = `${(Y(p[1]) / H) * r.height - 10}px`;
    });
    svg.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); });
  }

  // ───────── Live ─────────
  const toRows = (a) => a.filter((c) => c.closed).map((c) => [c.time, c.open, c.high, c.low, c.close]);

  async function refresh() {
    try {
      const now = Date.now();
      const [m15, m30, h1raw] = await Promise.all([History.fetchRange('15m', now - 3000 * 900e3), History.fetchRange('30m', now - 3000 * 1800e3), History.fetchRange('1h', now - 3000 * 3600e3)]);
      const forming = m15.at(-1);
      const h1 = Research.build(toRows(h1raw), 60), h4 = Research.build(toRows(h1raw), 240);
      const frames = { 15: Research.build(toRows(m15), 15), 30: Research.build(toRows(m30), 30), 60: h1, 240: h4 };
      for (const [tf, c] of Object.entries(frames)) c.htf = { h1: Research.htfTrend(c, +tf, h1, 60), h4: Research.htfTrend(c, +tf, h4, 240) };

      const today = Sessions.dayKey(now);
      const open = [], todays = [], recent = [], fresh = [];
      for (const l of D.legs) {
        const c = frames[l.tf], strat = Research.STRATS[l.id];
        const trades = Research.backtest(c, strat, l.params, { cost: D.cost });
        const last = trades.at(-1);
        const isOpen = last && last.why === 'end';
        if (isOpen) open.push({ l, t: last, price: c.at(-1).close });
        // A signal on the last closed candle: enter at the open of the candle forming now.
        const sig = !isOpen && Research.entrySignal(c, strat, l.params, strat.prepare(c, l.params), c.length - 1);
        if (sig) {
          const entry = forming && !forming.closed ? forming.close : c.at(-1).close;
          const p = { l, dir: sig.dir, entry, stop: sig.stop, target: sig.target, time: c.at(-1).time + l.tf * 60e3, pending: true };
          todays.push(p); fresh.push(p);
        }
        for (const t of trades) {
          const row = { l, dir: t.dir, entry: t.entry, stop: t.stop, target: t.target, exit: t.exit, r: t.r, why: t.why, time: t.entryTime, exitTime: t.exitTime };
          if (Sessions.dayKey(t.entryTime) === today) todays.push(row);
          if (t.entryTime >= now - 7 * 86400e3) recent.push(row);
          if (Sessions.dayKey(t.entryTime) === today) fresh.push(row);
        }
      }
      todays.sort((a, b) => b.time - a.time);
      recent.sort((a, b) => b.time - a.time);

      $('price').textContent = fmt(forming ? forming.close : frames[30].at(-1).close);
      $('updated').textContent = 'live · ' + new Date().toLocaleTimeString();
      $('dayLabel').textContent = `(${todays.length} so far · NY trading day started 5 PM NY yesterday)`;
      const pend = todays.filter((x) => x.pending);
      $('newSignal').innerHTML = pend.length
        ? pend.map((x) => `<div class="verdict ${x.dir === 1 ? 'good' : 'bad'}"><b>NEW ${x.dir === 1 ? 'BUY' : 'SELL'} — ${legName(x.l)}</b> · enter now ≈ ${fmt(x.entry)} · stop ${fmt(x.stop)}${x.target ? ` · target ${fmt(x.target)}` : ''} · ${exitRule(x.l, x.dir)}</div>`).join('')
        : '<div class="verdict">No new signal on the latest candle. Checking again every minute.</div>';
      const longs = open.filter((o) => o.t.dir === 1).length, shorts = open.length - longs;
      const exposure = open.length ? `<tr><td colspan="7" class="mono">Combined risk now: ${(Math.max(longs, shorts) * D.riskPct).toFixed(2)}% on ${longs >= shorts ? 'longs' : 'shorts'}${longs && shorts ? ` (and ${(Math.min(longs, shorts) * D.riskPct).toFixed(2)}% the other way)` : ''}. The rules often agree at the same moment — that is one idea, not ${open.length} separate ones.</td></tr>` : '';
      $('open').innerHTML = open.length
        ? '<tr><th>Rule</th><th>Side</th><th>Since</th><th>Entry</th><th>Stop</th><th>Target / exit</th><th>Now</th></tr>' + open.map(({ l, t, price }) => {
          const r = ((price - t.entry) * t.dir) / Math.abs(t.entry - t.stop);
          return `<tr><td>${legName(l)}</td><td>${side(t.dir)}</td><td>${time(t.entryTime)}</td><td>${fmt(t.entry)}</td><td>${fmt(t.stop)}</td><td>${t.target ? fmt(t.target) : exitRule(l, t.dir)}</td><td class="${cls(r)}">${sR(r)}</td></tr>`;
        }).join('') + exposure
        : '<tr><td>No open positions.</td></tr>';
      const row = (x) => `<tr><td>${time(x.time)} <small>${nyTime(x.time)}</small></td><td>${legName(x.l)}</td><td>${side(x.dir)}</td><td>${fmt(x.entry)}</td><td>${fmt(x.stop)}</td>
        <td>${x.pending ? tag('new — enter now', 'neutral') : x.why === 'end' ? tag('open', 'neutral') : `${WHY[x.why] || x.why} <span class="${cls(x.r)}">${sR(x.r)}</span>`}</td></tr>`;
      const head = '<tr><th>Time</th><th>Rule</th><th>Side</th><th>Entry</th><th>Stop</th><th>Result</th></tr>';
      $('today').innerHTML = todays.length ? head + todays.map(row).join('') : '<tr><td>No signals yet today.</td></tr>';
      const closed = recent.filter((x) => x.why !== 'end');
      const tot = closed.reduce((s, x) => s + x.r, 0);
      $('recent').innerHTML = recent.length ? head + recent.map(row).join('') +
        `<tr><td colspan="6" class="mono">${closed.length} closed in 7 days · ${(closed.filter((x) => x.r > 0).length / (closed.length || 1) * 100).toFixed(0)}% winners · total ${sR(tot)} (= ${pct(tot * D.riskPct)} at ${D.riskPct}% risk)</td></tr>` : '<tr><td>No signals in the last 7 days.</td></tr>';

      // Alerts for signals not seen before (not on the first load).
      const keys = fresh.map((x) => `${x.l.tf}${x.l.id}${x.time}${x.dir}`);
      const unseen = fresh.filter((x, i) => !st.seen.includes(keys[i]));
      st.seen = [...new Set(st.seen.concat(keys))].slice(-300);
      save();
      if (!firstLoad && unseen.length && $('alerts').checked) alertUser(unseen);
      firstLoad = false;
      setStatus('live');
    } catch (e) {
      setStatus('error');
      $('open').innerHTML = `<tr><td>Live data unavailable: ${e.message}</td></tr>`;
    }
  }

  function alertUser(list) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      o.frequency.value = list[0].dir === 1 ? 880 : 440;
      o.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.3);
    } catch { /* audio unavailable */ }
    if ('Notification' in window && Notification.permission === 'granted') {
      for (const x of list) new Notification(`XAUUSD ${x.dir === 1 ? 'BUY' : 'SELL'} · ${legName(x.l)}`, { body: `Entry ≈ ${fmt(x.entry)} · stop ${fmt(x.stop)}${x.target ? ' · target ' + fmt(x.target) : ''}` });
    }
  }

  if (!D) { document.querySelector('main').innerHTML = '<p class="hint">Signal data missing — run scripts/research/intraday.js.</p>'; return; }
  $('alerts').checked = !!st.alerts;
  $('alerts').addEventListener('change', (e) => {
    st.alerts = e.target.checked; save();
    if (e.target.checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  });
  renderStatic();
  renderBench();
  renderForward();
  refresh();
  setInterval(refresh, 60000);
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(drawEquity, 200); });
})();
