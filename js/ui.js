/* Shared UI helpers for every page: formatting, navigation (top + phone tab bar), the
 * news countdown / no-trade banner, the position size calculator and alerts. */
(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const fmt = (v, d = 2) => (v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pct = (v, d = 1) => (v == null || !isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`);
  const sR = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`;
  const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  const arrow = (v) => (v > 0 ? '▲ ' : v < 0 ? '▼ ' : '');
  const tag = (txt, kind) => `<span class="tag ${kind}">${txt}</span>`;
  const side = (dir) => tag(dir === 1 ? '▲ BUY' : '▼ SELL', dir === 1 ? 'buy' : 'sell');
  // Dates always shown with day + month, in the viewer's time zone (labelled once in the UI).
  const when = (t) => new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'local time'; } })();
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
  const tfName = (tf) => (tf === 60 ? '1H' : tf === 240 ? '4H' : tf + 'm');
  const legName = (l) => `${tfName(l.tf)} ${l.label}`;
  const exitRule = (l, dir) => (l.id === 'bbrev' ? `target: middle band · max ${l.params.maxBars} candles`
    : l.id === 'donchian' ? `exit on a close beyond the ${l.params.m}-candle ${dir === 1 ? 'low' : 'high'}`
    : l.id === 'pullback' ? `exit when RSI(${l.params.len}) ${dir === -1 ? '< ' + (100 - l.params.exit) : '> ' + l.params.exit} · max ${l.params.maxBars} candles`
    : l.id === 'orb' ? `target ${l.params.tp}× Asia range · flat by 4 PM NY`
    : l.id === 'ema' ? 'exit on the opposite EMA cross · trailing stop' : 'see rules');
  const WHY = { signal: 'exit rule', stop: 'stopped', target: 'target', time: 'time limit', eod: '4 PM close', 'session end': '4 PM close', end: 'open' };

  // ───────── Navigation ─────────
  const PAGES = [
    ['index.html', 'Desk', '◉'], ['signals.html', 'Signals', '⚡'], ['research.html', 'Research', '📊'], ['momentum.html', 'Chart', '📈'], ['crt.html', 'CRT Lab', '🧪'],
  ];
  function nav(active) {
    const top = $('nav');
    if (top) top.innerHTML = PAGES.map(([h, n]) => `<a href="${h}"${h === active ? ' class="active" aria-current="page"' : ''}>${n}</a>`).join('');
    if (!document.querySelector('.tabbar')) {
      const bar = document.createElement('nav');
      bar.className = 'tabbar';
      bar.setAttribute('aria-label', 'Pages');
      bar.innerHTML = PAGES.map(([h, n, i]) => `<a href="${h}"${h === active ? ' class="active" aria-current="page"' : ''}><span aria-hidden="true">${i}</span>${n}</a>`).join('');
      document.body.appendChild(bar);
    }
  }

  // ───────── News guard ─────────
  const BEFORE = 30 * 60e3, AFTER = 15 * 60e3;
  const eventTime = (date, t) => {
    const [y, m, d] = date.split('-').map(Number), [hh, mm] = t.split(':').map(Number);
    return Date.UTC(y, m - 1, d, hh, mm) - root.Sessions.nyOffset(Date.UTC(y, m - 1, d, 12));
  };
  function events() { return ((root.EVENTS && root.EVENTS.events) || []).map(([type, date, t]) => ({ type, date, timeNY: t, t: eventTime(date, t) })); }
  function upcoming(n = 3, now = Date.now()) { return events().filter((e) => e.t + AFTER > now).slice(0, n); }
  function countdown(ms) {
    const s = Math.max(0, Math.round(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m} min`;
  }
  // State relative to the next release: 'blackout' (30 min before → 15 min after) or 'clear'.
  function newsState(now = Date.now()) {
    const next = upcoming(1, now)[0];
    if (!next) return { state: 'unknown', next: null };
    const dt = next.t - now;
    return { state: dt <= BEFORE && dt >= -AFTER ? 'blackout' : 'clear', next, dt };
  }
  function renderNews() {
    const s = newsState();
    const pill = $('newsPill'), banner = $('newsBanner');
    if (pill) {
      if (!s.next) pill.innerHTML = '<span class="pill warn">Calendar empty — update events</span>';
      else pill.innerHTML = `<span class="pill ${s.state === 'blackout' ? 'bad' : 'muted'}" title="Next high-impact US release: ${s.next.type} ${s.next.date} ${s.next.timeNY} New York">📅 ${s.next.type} ${s.dt > 0 ? 'in ' + countdown(s.dt) : 'now'}</span>`;
    }
    if (banner) {
      banner.hidden = s.state !== 'blackout';
      if (s.state === 'blackout') banner.innerHTML = `⚠️ <b>${s.next.type} ${s.dt > 0 ? 'in ' + countdown(s.dt) : 'released ' + countdown(-s.dt) + ' ago'}</b> — no new entries until 15 min after the release. Expect a $6–10+ spike: consider closing or widening tight stops.`;
    }
    const last = root.EVENTS && root.EVENTS.last;
    if (pill && last && Date.parse(last) - Date.now() < 21 * 86400e3) pill.insertAdjacentHTML('beforeend', ' <span class="pill warn" title="Run scripts/build-events.js after adding new release dates">calendar ends ' + last + '</span>');
  }

  // ───────── Position sizing ─────────
  const SKEY = 'tradingking.sizing';
  const DEFAULTS = { balance: 10000, riskPct: 0.25, ozPerLot: 100, spread: 0.3, pip: 0.1 };
  const pips = (usd) => Math.round(Math.abs(usd) / (sizing().pip || 0.1));
  function sizing() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SKEY)) }; } catch { return { ...DEFAULTS }; } }
  function saveSizing(s) { try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch { /* storage unavailable */ } }
  // Lots so that a stop-out (plus spread) loses riskPct of the balance.
  function size(entry, stop, s = sizing()) {
    const dist = Math.abs(entry - stop);
    const riskUsd = (s.balance * s.riskPct) / 100;
    const perLot = (dist + s.spread) * s.ozPerLot;
    const lots = perLot > 0 ? Math.floor((riskUsd / perLot) * 100) / 100 : 0;
    return { lots, riskUsd: lots * perLot, dist, perLot };
  }
  const sizeLine = (entry, stop, target) => {
    const z = size(entry, stop);
    const rr = target != null ? Math.abs(target - entry) / Math.max(z.dist, 1e-9) : null;
    return z.lots > 0
      ? `<b>${z.lots.toFixed(2)} lot</b> · $${fmt(z.riskUsd, 0)} at risk · SL ${pips(z.dist)} pips${target != null ? ` · TP ${pips(target - entry)} pips` : ''}${rr ? ` · R:R 1:${rr.toFixed(1)}` : ''}`
      : `Stop too wide for your risk — position below 0.01 lot`;
  };

  // ───────── Alerts (one reusable AudioContext) ─────────
  let actx = null;
  function beep(up) {
    try {
      actx = actx || new (root.AudioContext || root.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = up ? 880 : 440; g.gain.value = 0.15;
      o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.3);
    } catch { /* audio unavailable */ }
  }
  function notify(title, body) { if ('Notification' in root && Notification.permission === 'granted') new Notification(title, { body }); }

  function setStatus(s) { const el = $('status'); if (!el) return; el.className = 'status ' + s; el.querySelector('b').textContent = s; }
  // Small "data age" label that turns amber after 2 min and red after 5.
  function age(el, t) { if (!el) return; const m = (Date.now() - t) / 60000; el.textContent = 'updated ' + clock(t); el.className = 'age ' + (m > 5 ? 'down' : m > 2 ? 'warn' : ''); }

  function shell(active) {
    nav(active);
    renderNews();
    setInterval(renderNews, 30000);
  }

  root.UI = { pips, $, fmt, pct, sR, cls, arrow, tag, side, when, clock, tz, ago, tfName, legName, exitRule, WHY, nav, shell, newsState, upcoming, countdown, renderNews, sizing, saveSizing, size, sizeLine, beep, notify, setStatus, age };
})(window);
