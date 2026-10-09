(function () {
  'use strict';
  const U = window.UI, D = window.INTRADAY, F = window.FORWARD;
  const { $, fmt, pct, sR, cls, arrow, side, when, legName, exitRule, WHY } = U;
  const KEY = 'tradingking.desk';
  const st = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* storage unavailable */ } };
  st.seen = st.seen || [];
  let last = null, firstLoad = true, prevPrice = null;

  U.shell('index.html');
  $('tz').textContent = U.tz;

  // ───────── Position size settings ─────────
  const fields = { szBalance: 'balance', szRisk: 'riskPct', szOz: 'ozPerLot', szSpread: 'spread', szPip: 'pip' };
  const s0 = U.sizing();
  for (const [id, k] of Object.entries(fields)) {
    $(id).value = s0[k];
    $(id).addEventListener('input', () => {
      const s = U.sizing();
      const v = parseFloat($(id).value);
      if (isFinite(v) && v >= 0) { s[k] = v; U.saveSizing(s); if (last) renderLive(last); }
    });
  }

  // ───────── Signal and position cards ─────────
  function signalCard(x, live) {
    const stale = live && Math.abs(last.price - x.entry) > 0.25 * Math.abs(x.entry - x.stop);
    return `<article class="sig ${x.dir === 1 ? 'buy' : 'sell'}">
      <header>${side(x.dir)} <span class="rule">${legName(x.l)}</span> <span class="when">${when(x.time)}</span></header>
      <div class="lvls"><div><span>Entry ≈</span><b>${fmt(x.entry)}</b></div><div><span>Stop</span><b class="down">${fmt(x.stop)}</b></div>
        <div><span>${x.target != null ? 'Target' : 'Exit'}</span><b class="${x.target != null ? 'up' : ''}">${x.target != null ? fmt(x.target) : '<small>' + exitRule(x.l, x.dir) + '</small>'}</b></div></div>
      <p class="size">${U.sizeLine(x.entry, x.stop, x.target)}</p>
      ${live ? `<p class="valid ${stale ? 'warn' : ''}">${stale ? '⚠️ Price has moved more than ¼ of the stop distance — entry no longer at the tested level.' : '✓ Entry still valid · price ' + fmt(last.price)}</p>` : ''}
    </article>`;
  }

  function renderLive(o) {
    const pend = o.pending;
    const news = U.newsState();
    const nextIn = Math.max(0, Math.round((o.nextCheck - Date.now()) / 60000));
    $('signals').innerHTML = (news.state === 'blackout' ? `<p class="valid warn">⚠️ ${news.next.type} release window: spreads widen and price can spike $6–10+. The tested results include trades here, but skip if your spread is wide.</p>` : '') +
      (pend.length ? pend.map((x) => signalCard(x, true)).join('')
        : `<div class="empty">No new signal right now.<br><small>Next check at the ${U.clock(o.nextCheck)} candle close (in ${nextIn} min). The page refreshes every minute.</small></div>`);
    const today = o.todays.filter((x) => !x.pending);
    $('todayCount').textContent = `· ${o.todays.length} today (NY trading day)`;
    $('today').innerHTML = today.length ? today.map((x) => `<div class="mini ${x.dir === 1 ? 'buy' : 'sell'}">${side(x.dir)} <span>${legName(x.l)}</span> <span>${when(x.time)}</span> <span>@ ${fmt(x.entry)}</span>
      <b class="${x.why === 'end' ? '' : cls(x.r)}">${x.why === 'end' ? 'open' : arrow(x.r) + sR(x.r) + ' · ' + (WHY[x.why] || x.why)}</b></div>`).join('') : '<p class="hint">No signals yet today.</p>';

    // Open positions with live R, $ and distance to stop.
    const ex = o.exposure;
    $('riskBar').innerHTML = o.open.length
      ? `<div class="bar"><span class="long" style="width:${(ex.longs / Math.max(o.open.length, 1)) * 100}%"></span><span class="short" style="width:${(ex.shorts / Math.max(o.open.length, 1)) * 100}%"></span></div>
         <p class="hint"><b>${ex.longs} long · ${ex.shorts} short</b> · combined risk ≈ ${(Math.max(ex.longs, ex.shorts) * U.sizing().riskPct).toFixed(2)}% on ${ex.longs >= ex.shorts ? 'longs' : 'shorts'} at your risk setting. ${o.open.length > 1 && (ex.longs === 0 || ex.shorts === 0) ? 'Several rules agreeing is one idea, not separate bets.' : ''}</p>`
      : '';
    $('open').innerHTML = o.open.length ? o.open.map((p) => {
      const z = U.size(p.entry, p.stop);
      const usd = (o.price - p.entry) * p.dir * z.lots * U.sizing().ozPerLot;
      return `<article class="pos ${p.dir === 1 ? 'buy' : 'sell'}"><header>${side(p.dir)} <span class="rule">${legName(p.l)}</span> <span class="when">since ${when(p.time)}</span></header>
        <div class="lvls"><div><span>Entry</span><b>${fmt(p.entry)}</b></div><div><span>Stop</span><b class="down">${fmt(p.stop)}</b></div><div><span>Now</span><b class="${cls(p.r)}">${arrow(p.r)}${sR(p.r)}</b></div></div>
        <p class="size">${z.lots > 0 ? `${z.lots.toFixed(2)} lot → <b class="${cls(usd)}">${usd >= 0 ? '+' : '−'}$${fmt(Math.abs(usd), 0)}</b>` : `Stop $${fmt(z.dist, 0)} wide — below 0.01 lot at your risk setting`} · price $${fmt(p.toStop)} from stop · ${p.target != null ? 'target ' + fmt(p.target) : exitRule(p.l, p.dir)}</p></article>`;
    }).join('') : '<div class="empty">No open positions.</div>';

    // Price flash
    const el = $('price');
    el.textContent = fmt(o.price);
    if (prevPrice != null && o.price !== prevPrice) { el.classList.remove('flash-up', 'flash-down'); void el.offsetWidth; el.classList.add(o.price > prevPrice ? 'flash-up' : 'flash-down'); }
    prevPrice = o.price;
    if (o.change24 != null) { $('change').textContent = `${arrow(o.change24)}${pct(o.change24, 2)} 24h`; $('change').className = 'change ' + (o.change24 >= 0 ? 'up' : 'down'); }
    U.age($('actAge'), Date.now());
  }

  // ───────── 100-pip strategy (fixed SL / TP) ─────────
  const SL = window.SLTP;
  const sltpRule = SL && { ...SL.live, label: SL.live.label, params: SL.live.params };
  const fixed = SL && { sl: SL.slPips * SL.pip, tp: SL.live.tpPips * SL.pip };
  function sltpCard(x, live) {
    const pipUsd = U.sizing().pip || 0.1;
    return `<article class="sig ${x.dir === 1 ? 'buy' : 'sell'}">
      <header>${side(x.dir)} <span class="rule">${UI.tfName(sltpRule.tf)} ${sltpRule.label}</span> <span class="when">${when(x.time)}</span></header>
      <div class="lvls"><div><span>Entry ≈</span><b>${fmt(x.entry)}</b></div><div><span>Stop loss · ${U.pips(x.entry - x.stop)} pips</span><b class="down">${fmt(x.stop)}</b></div>
        <div><span>Take profit · ${U.pips(x.target - x.entry)} pips</span><b class="up">${fmt(x.target)}</b></div></div>
      <p class="size">${U.sizeLine(x.entry, x.stop, x.target)}${live ? ` · now ${fmt(live)} (${((live - x.entry) * x.dir / pipUsd).toFixed(0)} pips)` : ''}</p>
    </article>`;
  }
  function renderSltp() {
    if (!SL) return;
    const r = window.Engine.ruleState(sltpRule, fixed, SL.cost);
    if (!r) return;
    $('sltpSignal').innerHTML = r.pending ? sltpCard(r.pending) + '<p class="valid">✓ New signal on the latest 15m candle — enter at market.</p>'
      : r.open ? '<h3>Open trade</h3>' + sltpCard({ dir: r.open.dir, entry: r.open.entry, stop: r.open.stop, target: r.open.target, time: r.open.entryTime }, r.price)
      : `<div class="empty">No 100-pip signal right now.<br><small>Signals come about every 2 days (London + New York hours). Checked every minute.</small></div>`;
    $('sltpRecent').innerHTML = r.recent.length ? '<tr><th>Entered</th><th>Side</th><th>Entry</th><th>Result</th></tr>' + r.recent.map((t) =>
      `<tr><td data-k="Entered">${when(t.entryTime)}</td><td data-k="Side">${side(t.dir)}</td><td data-k="Entry">${fmt(t.entry)}</td><td data-k="Result" class="${cls(t.r)}">${t.why === 'target' ? '✓ TP' : t.why === 'stop' ? '✗ SL' : WHY[t.why] || t.why} ${arrow(t.r)}${((t.exit - t.entry) * t.dir / (U.sizing().pip || 0.1)).toFixed(0)} pips</td></tr>`).join('') : '';
    // Alerts
    const key = r.pending ? `${r.pending.time}${r.pending.dir}` : null;
    if (key && key !== st.sltpSeen) {
      if (st.sltpSeen !== undefined && $('sltpAlerts').checked) {
        U.beep(r.pending.dir === 1);
        U.notify(`XAUUSD ${r.pending.dir === 1 ? 'BUY' : 'SELL'} · 100-pip strategy`, `Entry ≈ ${fmt(r.pending.entry)} · SL ${fmt(r.pending.stop)} · TP ${fmt(r.pending.target)}`);
      }
      st.sltpSeen = key; save();
    } else if (st.sltpSeen === undefined) { st.sltpSeen = ''; save(); }
  }
  function renderSltpStatic() {
    if (!SL) { $('sltpSignal').innerHTML = '<p class="hint">Run scripts/research/fixed-sltp.js to generate this strategy.</p>'; return; }
    const c = SL.chosen, y = c.y2026, o = c.oos;
    $('sltpTp').textContent = SL.live.tpPips;
    $('sltpRule').textContent = `${UI.tfName(SL.live.tf)} ${SL.live.label}, re-chosen quarterly`;
    $('sltpTiles').innerHTML = [['2026 return', pct(y.returnPct), cls(y.returnPct)], ['2026 win rate', (y.winRate * 100).toFixed(0) + '%'], ['2026 max DD', y.maxDDPct.toFixed(1) + '%'],
      ['2023–25 (unseen)', pct(o.returnPct, 0), cls(o.returnPct)], ['2023–25 max DD', o.maxDDPct.toFixed(0) + '%'], ['Signals/day', y.perDay.toFixed(2)]]
      .map(([k, v, cl]) => `<div class="tile"><span>${k}</span><b class="${cl || ''}">${v}</b></div>`).join('');
    $('sltpNote').innerHTML = `Rule now: ${SL.live.rules}; exit at SL ${SL.slPips} pips, TP ${SL.live.tpPips} pips or after ${SL.live.params.hold} h. Results at ${SL.riskPct}% risk per trade, $${SL.cost} cost. <b class="warn">A fixed $10 stop is tight for 2026 gold (a 15-minute candle often moves $5–10), so it is roughly flat this year — risk 0.5% or less.</b>`;
  }

  async function refresh() {
    try {
      const o = await window.Engine.compute();
      last = o;
      renderLive(o);
      renderSltp();
      U.setStatus('live');
      // Alerts for signals not seen before (not on the first load).
      const keys = o.fresh.map((x) => `${x.l.tf}${x.l.id}${x.time}${x.dir}`);
      const unseen = o.fresh.filter((x, i) => !st.seen.includes(keys[i]));
      st.seen = [...new Set(st.seen.concat(keys))].slice(-300); save();
      if (!firstLoad && unseen.length) { U.beep(unseen[0].dir === 1); unseen.forEach((x) => U.notify(`XAUUSD ${x.dir === 1 ? 'BUY' : 'SELL'} · ${legName(x.l)}`, `Entry ≈ ${fmt(x.entry)} · stop ${fmt(x.stop)}`)); }
      firstLoad = false;
    } catch (e) {
      U.setStatus('error');
      $('signals').innerHTML = `<div class="empty">Live data unavailable (${e.message}). Retrying every minute.</div>`;
    }
  }

  async function refreshBias() {
    try {
      const b = await window.Engine.bias();
      const up = b.filter((x) => x.dir === 1).length, dn = b.filter((x) => x.dir === -1).length;
      const verdict = dn >= 4 ? ['bad', 'Bearish across timeframes'] : up >= 4 ? ['good', 'Bullish across timeframes'] : ['warn', 'Mixed — expect two-way trade'];
      $('bias').innerHTML = b.map((x) => `<span class="chip ${x.dir > 0 ? 'buy' : x.dir < 0 ? 'sell' : 'neutral'}" title="${x.tf}: close vs EMA50 vs EMA200">${x.tf} <b>${x.dir > 0 ? '▲ Up' : x.dir < 0 ? '▼ Down' : '◆ Range'}</b> <small>RSI ${fmt(x.rsi, 0)}</small></span>`).join('') +
        `<span class="chip verdict ${verdict[0]}">${verdict[1]}</span>`;
    } catch { $('bias').innerHTML = '<span class="hint">Trend data unavailable.</span>'; }
  }

  function renderStatic() {
    // Upcoming releases
    $('news').innerHTML = U.upcoming(3).map((e) => `<div class="news-item"><b>${e.type}</b> <span>${when(e.t)}</span> <span class="muted">${e.date.slice(5)} ${e.timeNY} NY · in ${U.countdown(e.t - Date.now())}</span></div>`).join('') || '<p class="hint">No releases in the calendar.</p>';
    // Live record (forward test) and backtest
    if (F) {
      const s = F.summary, staleH = (Date.now() - Date.parse(s.updated)) / 3600e3;
      $('fwdTiles').innerHTML = [['Days live', Math.max(1, Math.round((Date.now() - Date.parse(F.started)) / 86400e3))], ['Signals', s.signals], ['Closed', s.closed],
        ['Win rate', s.winRate == null ? '—' : (s.winRate * 100).toFixed(0) + '%'], ['Total', s.closed ? sR(s.totalR) : '—', cls(s.totalR)], ['Return', s.closed ? pct(s.returnPct, 2) : '—', cls(s.returnPct)]]
        .map(([k, v, c]) => `<div class="tile"><span>${k}</span><b class="${c || ''}">${v}</b></div>`).join('');
      $('fwdNote').innerHTML = `Updated ${U.ago(Date.parse(s.updated))}${staleH > 2 ? ' — <span class="warn">the recorder (a GitHub job every 15 min) sometimes runs late; the signals above are always live</span>' : ''}. Too early to judge until ~100 closed trades.`;
    }
    const y = D.ytd, r = D.record;
    $('btTiles').innerHTML = [['2026 return', pct(y.returnPct), cls(y.returnPct)], ['2026 max DD', y.maxDDPct.toFixed(1) + '%'], ['Signals/day', y.perDay.toFixed(1)], ['2023 → now', pct(r.returnPct, 0), cls(r.returnPct)]]
      .map(([k, v, c]) => `<div class="tile"><span>${k}</span><b class="${c || ''}">${v}</b></div>`).join('');
  }

  // Chart only loads when opened (it is heavy).
  $('chartBox').addEventListener('toggle', () => {
    if (!$('chartBox').open || $('tvChart').childElementCount) return;
    const s = document.createElement('script');
    s.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'; s.async = true;
    s.textContent = JSON.stringify({ autosize: true, symbol: 'OANDA:XAUUSD', interval: '15', timezone: 'Etc/UTC', theme: 'dark', style: '1', locale: 'en', support_host: 'https://www.tradingview.com' });
    const w = document.createElement('div'); w.className = 'tradingview-widget-container'; w.style.height = '100%';
    w.innerHTML = '<div class="tradingview-widget-container__widget" style="height:100%"></div>'; w.appendChild(s);
    $('tvChart').appendChild(w);
  });
  if ('Notification' in window && Notification.permission === 'default') {
    $('signals').insertAdjacentHTML('afterend', '<button class="ghost" id="enableAlerts">🔔 Enable signal alerts</button>');
    $('enableAlerts').addEventListener('click', () => { Notification.requestPermission(); $('enableAlerts').remove(); });
  }

  renderStatic();
  renderSltpStatic();
  $('sltpAlerts').checked = !!st.sltpAlerts;
  $('sltpAlerts').addEventListener('change', (e) => {
    st.sltpAlerts = e.target.checked; save();
    if (e.target.checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  });
  refresh();
  refreshBias();
  setInterval(refresh, 60000);
  setInterval(refreshBias, 5 * 60000);
  setInterval(renderStatic, 60000);
})();
