(function () {
  'use strict';
  const R = window.RESEARCH;
  const $ = (id) => document.getElementById(id);
  const fmt = (v, d = 2) => (v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pct = (v, d = 0) => (v == null || !isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`);
  const sR = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`;
  const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  const day = (t) => new Date(t).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  const date = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const tiles = (items) => items.map(([k, v, c]) => `<div class="tile"><span>${k}</span><b class="${c || ''}">${v}</b></div>`).join('');
  const tag = (txt, kind) => `<span class="tag ${kind}">${txt}</span>`;
  const sigKind = (s) => (/BUY|Up/.test(s) ? 'buy' : /SELL|Down/.test(s) ? 'sell' : 'neutral');
  function setStatus(s) { $('status').className = 'status ' + s; $('status').querySelector('b').textContent = s; }

  // ───────────── 1. Market now (live) ─────────────
  function snapshot(c, label) {
    const closes = c.map((x) => x.close);
    const e50 = Indicators.ema(closes, 50).at(-1), e200 = Indicators.ema(closes, 200).at(-1);
    const last = c.at(-1).close;
    const trend = e200 == null ? 'n/a' : last > e50 && e50 > e200 ? 'Uptrend' : last < e50 && e50 < e200 ? 'Downtrend' : 'Range / mixed';
    const sig = Signals.analyze(c.slice(-500));
    const look = c.slice(-21, -1);
    return {
      tf: label, close: last, ema50: e50, ema200: e200, rsi: Indicators.rsi(closes, 14).at(-1), atr: Indicators.atr(c, 14).at(-1), trend,
      signal: sig.ready ? sig.action : 'n/a', high20: Math.max(...look.map((x) => x.high)), low20: Math.min(...look.map((x) => x.low)),
    };
  }

  function renderNow(snaps, d1, w1) {
    $('mtf').innerHTML = '<tr><th>Timeframe</th><th>Trend</th><th>Signal</th><th>RSI 14</th><th>EMA 50</th><th>EMA 200</th><th>ATR 14</th><th>20-candle range</th></tr>' +
      snaps.map((s) => `<tr><td>${s.tf}</td><td>${tag(s.trend, sigKind(s.trend))}</td><td>${tag(s.signal, sigKind(s.signal))}</td>
        <td>${fmt(s.rsi, 0)}</td><td>${fmt(s.ema50)}</td><td>${fmt(s.ema200)}</td><td>$${fmt(s.atr)}</td><td>${fmt(s.low20)} – ${fmt(s.high20)}</td></tr>`).join('');
    const up = snaps.filter((s) => s.trend === 'Uptrend').length, dn = snaps.filter((s) => s.trend === 'Downtrend').length;
    const higher = snaps.slice(-2).map((s) => s.trend), lower = snaps.slice(0, 3).map((s) => s.trend);
    let text, kind;
    if (dn >= 4) { kind = 'bad'; text = `<b>Bearish across timeframes</b> — ${dn} of ${snaps.length} timeframes in a downtrend. Short-term sells line up with the bigger picture; buying here is counter-trend.`; }
    else if (up >= 4) { kind = 'good'; text = `<b>Bullish across timeframes</b> — ${up} of ${snaps.length} timeframes in an uptrend. Pullbacks to buy are with the trend.`; }
    else { kind = 'warn'; text = `<b>Mixed</b> — ${up} up, ${dn} down. Higher timeframes: ${higher.join(' / ')}; lower: ${lower.join(' / ')}. Expect choppy, two-way trade; reduce size.`; }
    $('overall').className = 'verdict ' + kind;
    $('overall').innerHTML = text;
    const pd = d1.at(-2), pw = w1.at(-2);
    $('levels').innerHTML = tiles([
      ['Price', fmt(snaps[0].close)], ['Prev. day high', fmt(pd.high)], ['Prev. day low', fmt(pd.low)],
      ['Prev. week high', fmt(pw.high)], ['Prev. week low', fmt(pw.low)], ['Daily ATR', '$' + fmt(snaps[3].atr)],
    ]);
    $('price').textContent = fmt(snaps[0].close);
  }

  async function loadNow() {
    try {
      const F = Feeds.binance;
      const [m15, h1, h4, d1, w1] = await Promise.all(['15m', '1h', '4h', '1d', '1w'].map((i) => F.fetchCandles(i, 1000)));
      const snaps = [snapshot(m15, '15m'), snapshot(h1, '1H'), snapshot(h4, '4H'), snapshot(d1, 'Daily'), snapshot(w1, 'Weekly')];
      renderNow(snaps, d1, w1);
      $('nowTime').textContent = 'live · ' + new Date().toLocaleTimeString();
      setStatus('live');
    } catch (e) {
      // Fall back to the snapshot saved in the report.
      setStatus('offline');
      $('overall').className = 'verdict warn';
      $('overall').innerHTML = `Live data unavailable (${e.message}). Showing the snapshot from ${date(R.now[0].time)}.`;
      $('mtf').innerHTML = '<tr><th>Timeframe</th><th>Trend</th><th>Signal</th><th>RSI 14</th><th>EMA 50</th><th>EMA 200</th><th>ATR 14</th><th>20-candle range</th></tr>' +
        R.now.map((s) => `<tr><td>${s.tf}</td><td>${tag(s.trend, sigKind(s.trend))}</td><td>${tag(s.signal, sigKind(s.signal))}</td><td>${fmt(s.rsi, 0)}</td><td>${fmt(s.ema50)}</td><td>${fmt(s.ema200)}</td><td>$${fmt(s.atr)}</td><td>${fmt(s.low20)} – ${fmt(s.high20)}</td></tr>`).join('');
    }
  }

  // ───────────── 2. Best strategy ─────────────
  function renderBest() {
    const P = R.portfolio, B = R.benchmark;
    if (!P) { $('bestIntro').textContent = 'No portfolio in this report.'; return; }
    $('bestIntro').innerHTML = `<div class="verdict ${P.test.returnPct > 0 ? 'good' : 'bad'}"><b>Trend portfolio:</b> three rules on the 1H and 4H charts, each risking 0.33% of the account per trade (1% in total).
      It was the top-3 of the training ranking (2020–2024) and stayed profitable on 2025–2026, which it never saw:
      <b>${pct(P.test.returnPct, 1)}</b> with a worst drawdown of ${P.test.maxDDPct.toFixed(1)}%, and <b>${pct(P.ytd.returnPct, 1)}</b> so far in 2026 (gold itself: ${pct(B.ytd.returnPct, 1)}).
      Returns are small because risk is small — they scale roughly with the risk you choose, and so do drawdowns.</div>`;
    $('bestTiles').innerHTML = tiles([
      ['Training 2020–24', pct(P.train.returnPct, 1), cls(P.train.returnPct)], ['Max DD (training)', P.train.maxDDPct.toFixed(1) + '%'],
      ['Test 2025–26', pct(P.test.returnPct, 1), cls(P.test.returnPct)], ['Max DD (test)', P.test.maxDDPct.toFixed(1) + '%'],
      ['2026 so far', pct(P.ytd.returnPct, 1), cls(P.ytd.returnPct)], ['Trades 2025–26', P.test.n],
    ]);
    $('legs').innerHTML = '<tr><th>Rule</th><th>How to trade it</th><th>Train</th><th>2025–26</th><th>2026</th></tr>' +
      P.legs.map((l) => `<tr><td><b>${l.tf} ${l.label}</b></td><td class="mono">${l.rules}</td>
        <td class="${cls(l.train.returnPct)}">${pct(l.train.returnPct)}</td><td class="${cls(l.test.returnPct)}">${pct(l.test.returnPct)}</td><td class="${cls(l.ytd.returnPct)}">${pct(l.ytd.returnPct)}</td></tr>`).join('') +
      '<tr><td colspan="5" class="mono">Per-rule results are at 1% risk per trade; in the portfolio each rule risks 0.33%.</td></tr>';
    const F = R.firstPick;
    $('method').innerHTML = `<ol class="playbook">
      <li>Five strategy families (EMA trend, Donchian breakout, RSI trend pullback, Bollinger mean reversion, Asia-range breakout) were tested on 15m, 1H, 4H and daily candles — every combination of their settings, with $${R.cost} cost per trade and next-candle fills.</li>
      <li>Settings were chosen <b>only on Sep 2020 – Dec 2024</b>, and had to be profitable in at least 3 of 4 slices of that period.</li>
      <li>${F ? `My first ranking rule (best risk-adjusted return) picked <b>${F.tf} ${F.label}</b>: ${pct(F.train.returnPct)} in training but with a ${F.train.maxDDPct.toFixed(0)}% drawdown — and it then <b>lost ${Math.abs(F.test.returnPct).toFixed(0)}%</b> in 2025–26. High-frequency mean reversion broke down when gold started trending hard.` : ''}</li>
      <li>So the ranking was changed to reject any strategy with a training drawdown above 25% and rank by return ÷ drawdown. (This change was made after seeing that failure, so treat it with some caution.) The top 3 of that ranking form the portfolio.</li>
      <li>Trend-following worked best in 2025–26 because gold trended strongly; mean reversion lost. If gold turns into a long sideways range, expect the portfolio to give back some gains.</li>
    </ol>`;
    drawEquity();
  }

  // Two series on one scale (both indexed to 100): portfolio and buy & hold.
  function drawEquity() {
    const el = $('equity');
    const a = R.curves.portfolio || [], b = R.curves.hold || [];
    if (!a.length) return;
    const W = el.clientWidth || 800, H = 280, m = { l: 46, r: 92, t: 14, b: 26 };
    const t0 = Math.min(a[0][0], b[0][0]), t1 = Math.max(a.at(-1)[0], b.at(-1)[0]);
    const ys = a.map((p) => p[1]).concat(b.map((p) => p[1]));
    const y0 = Math.min(...ys) * 0.97, y1 = Math.max(...ys) * 1.03;
    const X = (t) => m.l + ((t - t0) / (t1 - t0)) * (W - m.l - m.r);
    const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);
    const path = (s) => s.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    const step = [10, 20, 25, 50, 100].find((s) => (y1 - y0) / s <= 6) || 100;
    let grid = '';
    for (let v = Math.ceil(y0 / step) * step; v <= y1; v += step) grid += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" class="${v === 100 ? 'zero' : 'grid'}"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
    let xl = '';
    for (let y = new Date(t0).getUTCFullYear() + 1; y <= new Date(t1).getUTCFullYear(); y++) xl += `<text x="${X(Date.UTC(y, 0, 1))}" y="${H - 8}" text-anchor="middle">${y}</text>`;
    const ts = R.period.testStart;
    const split = `<line x1="${X(ts)}" x2="${X(ts)}" y1="${m.t}" y2="${H - m.b}" class="split"/><text x="${X(ts) + 6}" y="${m.t + 10}" class="split-label">test →</text><text x="${X(ts) - 6}" y="${m.t + 10}" text-anchor="end" class="split-label">← training</text>`;
    const endA = a.at(-1), endB = b.at(-1);
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Portfolio vs buy and hold, indexed to 100">
      ${grid}${xl}${split}<path d="${path(b)}" class="s2"/><path d="${path(a)}" class="s1"/>
      <text x="${X(endA[0]) + 6}" y="${Y(endA[1]) + 4}" class="end-label">Portfolio ${endA[1].toFixed(0)}</text>
      <text x="${X(endB[0]) + 6}" y="${Y(endB[1]) + 4}" class="end-label">Gold ${endB[1].toFixed(0)}</text>
      <line class="cross" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>
      <circle class="dot d1" r="4" visibility="hidden" style="fill:#c08a1e"/><circle class="dot d2" r="4" visibility="hidden" style="fill:#5f86d6"/>
      <rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/></svg><div class="tip" hidden></div>`;
    $('legend').innerHTML = '<span><i style="background:#c08a1e"></i>Trend portfolio (1% total risk per trade)</span><span><i style="background:#5f86d6"></i>Buy &amp; hold gold</span><span>Both start at 100</span>';
    const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), cross = svg.querySelector('.cross'), d1 = svg.querySelector('.d1'), d2 = svg.querySelector('.d2');
    const near = (s, t) => { let lo = 0, hi = s.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (s[mid][0] < t) lo = mid + 1; else hi = mid; } return s[lo]; };
    svg.addEventListener('pointermove', (ev) => {
      const r = svg.getBoundingClientRect();
      const t = t0 + ((((ev.clientX - r.left) / r.width) * W - m.l) / (W - m.l - m.r)) * (t1 - t0);
      const pa = near(a, t), pb = near(b, t);
      cross.setAttribute('x1', X(t)); cross.setAttribute('x2', X(t)); cross.setAttribute('visibility', 'visible');
      d1.setAttribute('cx', X(pa[0])); d1.setAttribute('cy', Y(pa[1])); d1.setAttribute('visibility', 'visible');
      d2.setAttribute('cx', X(pb[0])); d2.setAttribute('cy', Y(pb[1])); d2.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.innerHTML = `${day(t)}<br>Portfolio <b>${pa[1].toFixed(1)}</b><br>Gold <b>${pb[1].toFixed(1)}</b>`;
      tip.style.left = `${Math.min((X(t) / W) * r.width + 12, r.width - 140)}px`;
      tip.style.top = '20px';
    });
    svg.addEventListener('pointerleave', () => { tip.hidden = true; [cross, d1, d2].forEach((n) => n.setAttribute('visibility', 'hidden')); });
  }

  // Run each portfolio rule on recent 1H data to show its current position.
  async function loadLegStatus() {
    const P = R.portfolio;
    if (!P) return;
    try {
      const hourly = await History.fetchRange('1h', Date.now() - 3000 * 3600e3);
      const rows = hourly.filter((c) => c.closed).map((c) => [c.time, c.open, c.high, c.low, c.close]);
      const frames = { '1H': Research.build(rows, 60), '4H': Research.build(rows, 240) };
      $('legStatus').innerHTML = '<tr><th>Rule</th><th>Status</th><th>Entry</th><th>Stop now</th><th>Since</th><th>Last closed trade</th></tr>' + P.legs.map((l) => {
        const c = frames[l.tf];
        const st = Research.STRATS[l.id];
        const trades = Research.backtest(c, st, l.params, { cost: R.cost });
        const open = trades.length && trades.at(-1).why === 'end' ? trades.at(-1) : null;
        const lastClosed = trades.filter((t) => t.why !== 'end').at(-1);
        const sig = !open && st.entry(st.prepare(c, l.params), c.length - 1);
        const status = open ? tag(open.dir === 1 ? 'LONG — open' : 'SHORT — open', open.dir === 1 ? 'buy' : 'sell')
          : sig ? tag(sig.dir === 1 ? 'BUY signal — enter next candle' : 'SELL signal — enter next candle', sig.dir === 1 ? 'buy' : 'sell') : tag('Flat — no signal', 'neutral');
        return `<tr><td>${l.tf} ${l.label}</td><td>${status}</td><td>${open ? fmt(open.entry) : sig ? '~' + fmt(c.at(-1).close) : '—'}</td>
          <td>${open ? fmt(open.stop) : sig ? fmt(sig.stop) : '—'}</td><td>${open ? date(open.entryTime) : '—'}</td>
          <td>${lastClosed ? `${lastClosed.dir === 1 ? 'Long' : 'Short'} ${date(lastClosed.exitTime)} · <span class="${cls(lastClosed.r)}">${sR(lastClosed.r)}</span>` : '—'}</td></tr>`;
      }).join('');
    } catch (e) {
      $('legStatus').innerHTML = `<tr><td>Live status unavailable: ${e.message}</td></tr>`;
    }
  }

  // ───────────── 3. Matrix ─────────────
  function renderMatrix() {
    const tfs = ['15m', '1H', '4H', 'D'];
    const fams = [...new Set(R.matrix.map((m) => m.label))];
    const inPortfolio = new Set((R.portfolio ? R.portfolio.legs : []).map((l) => l.tf + l.label));
    $('matrix').innerHTML = `<tr><th>Strategy</th>${tfs.map((t) => `<th>${t === 'D' ? 'Daily' : t}</th>`).join('')}</tr>` + fams.map((f) => `<tr><td><b>${f}</b></td>${tfs.map((t) => {
      const m = R.matrix.find((x) => x.label === f && x.tf === t);
      if (!m) return '<td><small>n/a</small></td>';
      if (m.none) return '<td><small>too few trades</small></td>';
      return `<td${inPortfolio.has(t + f) ? ' class="sel"' : ''} title="${m.rules}"><span class="big ${cls(m.test.returnPct)}">${pct(m.test.returnPct)}</span>
        <small>train ${pct(m.train.returnPct)} · DD ${m.train.maxDDPct.toFixed(0)}%<br>2026 ${pct(m.ytd.returnPct)} · ${m.test.n} trades</small></td>`;
    }).join('')}</tr>`).join('') +
      `<tr><td><b>Buy &amp; hold gold</b></td><td colspan="4"><span class="big ${cls(R.benchmark.test.returnPct)}">${pct(R.benchmark.test.returnPct)}</span><small>2020–24 ${pct(R.benchmark.train.returnPct)} · 2026 ${pct(R.benchmark.ytd.returnPct)} · worst drop 2025–26 ${R.benchmark.test.maxDDPct.toFixed(0)}% (full position, not 1% risk)</small></td></tr>`;
  }

  // ───────────── 4. News ─────────────
  const NAMES = { CPI: 'CPI — consumer inflation', PPI: 'PPI — producer inflation', NFP: 'NFP — jobs report', FOMC: 'FOMC — Fed rate decision' };
  const TIMES = { CPI: '8:30 AM NY', PPI: '8:30 AM NY', NFP: '8:30 AM NY', FOMC: '2:00 PM NY' };
  const RULE_NAMES = { follow: 'Follow the first move', fade: 'Fade the first move', straddle: 'Pre-news range breakout' };
  const ruleDesc = (rule, p) => (rule === 'straddle'
    ? `Break of the 30-min pre-release range; stop other side; ${p.rr ? 'target ' + p.rr + 'R' : 'no target'}; out after ${p.hold} min`
    : `${rule === 'follow' ? 'With' : 'Against'} the first ${p.wait}-min move; stop beyond it; ${p.rr ? 'target ' + p.rr + 'R' : 'no target'}; out after ${p.hold} min`);

  function renderNews() {
    const N = R.news;
    $('newsCards').innerHTML = Object.entries(N.byType).map(([k, v]) => {
      const a = v.all, y = v.y2026;
      return `<div class="news-card"><h3>${NAMES[k]} <small>${TIMES[k]}</small></h3><table>
        <tr><td>Releases studied</td><td>${a.n}</td></tr>
        <tr><td>First 5 min vs normal</td><td><b>${fmt(a.volMultiple, 1)}×</b> wider</td></tr>
        <tr><td>Typical move 15 min / 1 h / 4 h</td><td>$${fmt(a.medAbs15, 0)} / $${fmt(a.medAbs60, 0)} / $${fmt(a.medAbs240, 0)}</td></tr>
        <tr><td>Typical 4 h move in 2026</td><td><b>$${fmt(y.medAbs240, 0)}</b> (${y.n} releases)</td></tr>
        <tr><td>First 15 min direction continues</td><td>${(a.continuation * 100).toFixed(0)}% of the time</td></tr>
        <tr><td>Gold up 4 h later</td><td>${(a.up240 * 100).toFixed(0)}%</td></tr>
      </table></div>`;
    }).join('');
    $('newsRules').innerHTML = '<tr><th>Release</th><th>Best rule on 2020–24</th><th>Train avg</th><th>Train n</th><th>2025–26 avg</th><th>2025–26 n</th><th>Win rate</th></tr>' +
      Object.entries(N.rules).map(([k, v]) => {
        const t = v.top[0];
        return `<tr><td><b>${k === 'ALL' ? 'All four' : k}</b></td><td class="mono">${RULE_NAMES[t.rule]}: ${ruleDesc(t.rule, t.p)}</td>
          <td class="${cls(t.train.avgR)}">${sR(t.train.avgR)}</td><td>${t.train.n}</td><td class="${cls(t.test.avgR)}">${sR(t.test.avgR)}</td><td>${t.test.n}</td><td>${(t.test.winRate * 100).toFixed(0)}%</td></tr>`;
      }).join('') + `<tr><td colspan="7" class="mono">Results in R (multiples of the risk per trade) after $${R.newsCost} cost per trade; stops are at least 0.07% of price. Small samples — 13 to 21 releases per type in 2025–26.</td></tr>`;
    const cont = Object.values(N.byType).map((v) => v.all.continuation);
    const all = N.rules.ALL.top[0];
    $('playbook').innerHTML = [
      `<b>The direction of the first move is a coin flip.</b> After the first 15 minutes, gold kept going the same way only ${Math.round(Math.min(...cont) * 100)}–${Math.round(Math.max(...cont) * 100)}% of the time. Neither chasing nor fading the spike worked reliably.`,
      `<b>Volatility is the reliable part.</b> The first 5 minutes are about 4× wider than normal for CPI, NFP and FOMC (2× for PPI), and 2026 moves are much bigger than earlier years. Size positions for that range, not for a normal candle.`,
      `<b>Best tested rule:</b> mark the 30-minute range before the release and trade the first break of it, stop on the other side. Pooled over all four releases it made ${sR(all.train.avgR)} per trade in 2020–24 and ${sR(all.test.avgR)} in 2025–26 (${all.test.n} trades, ${(all.test.winRate * 100).toFixed(0)}% winners). Per release type it was mixed (CPI and FOMC were negative in 2025–26), so treat it as a small edge, not a sure thing.`,
      `<b>Real fills are worse than the test.</b> Spreads on spot gold widen to several dollars for seconds after the release, and stop orders slip. If your broker's spread blows out, the edge disappears — trade smaller or wait 5–15 minutes.`,
      `<b>Don't sit through a release with a tight stop</b> from another trade: a ${'$'}6–10 spike is normal. Either close, widen the stop and cut size, or move it to breakeven well before 8:30 / 2:00 PM.`,
      `<b>Combine with the trend:</b> the timeframe table above tells you which side the bigger trend favours. News spikes against a strong higher-timeframe trend tend to be the ones that get sold/bought back.`,
      `<b>Missing piece:</b> this study doesn't know the forecast vs actual numbers (the "surprise"), which is what really drives direction. Check the consensus on an economic calendar before each release.`,
    ].map((x) => `<li>${x}</li>`).join('');
  }

  function renderUpcoming() {
    const now = Date.now();
    const toUtc = (e) => {
      const [y, m, d] = e.date.split('-').map(Number), [hh, mm] = e.timeNY.split(':').map(Number);
      return Date.UTC(y, m - 1, d, hh, mm) - Sessions.nyOffset(Date.UTC(y, m - 1, d, 12));
    };
    const list = R.upcoming.map((e) => ({ ...e, t: toUtc(e) })).filter((e) => e.t > now);
    $('upcoming').innerHTML = list.length ? '<tr><th>Release</th><th>New York time</th><th>Your time</th><th>In</th><th>Typical 4 h move (2026)</th></tr>' + list.map((e) => {
      const dd = Math.floor((e.t - now) / 86400e3), hh = Math.floor(((e.t - now) % 86400e3) / 3600e3);
      const y = R.news.byType[e.type] && R.news.byType[e.type].y2026;
      return `<tr><td><b>${e.type}</b></td><td>${e.date} ${e.timeNY}</td><td>${date(e.t)}</td><td>${dd ? dd + 'd ' : ''}${hh}h</td><td>${y && y.n ? '$' + fmt(y.medAbs240, 0) : '—'}</td></tr>`;
    }).join('') : '<tr><td>No upcoming releases in the saved calendar — regenerate the report.</td></tr>';
  }

  if (!R) { document.querySelector('main').innerHTML = '<p class="hint">Research data missing — run scripts/research/run.js.</p>'; return; }
  renderBest();
  renderMatrix();
  renderNews();
  renderUpcoming();
  loadNow();
  loadLegStatus();
  setInterval(loadNow, 60000);
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(drawEquity, 200); });
})();
