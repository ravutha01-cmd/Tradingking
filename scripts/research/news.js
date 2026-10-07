/* News event study for gold around US releases (CPI, PPI, NFP, FOMC) on 5-minute data,
 * plus simple news-trading rules tested on 2020–2024 and checked on 2025–2026. */
const S = require('../../js/sessions.js');
const { MIN, combos } = require('./lib.js');

const NEWS_COST = 1.0; // round-trip spread + slippage around releases ($/oz)
const MIN_RISK = 0.0007; // minimum stop distance as a share of price (≈ $3 at $4,000): no unrealistically tight stops

// Widen a stop that is closer than MIN_RISK to the entry.
const floorStop = (entry, stop, dir) => ((entry - stop) * dir < entry * MIN_RISK ? entry - dir * entry * MIN_RISK : stop);

function eventTime(date, timeNY) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = timeNY.split(':').map(Number);
  const off = S.nyOffset(Date.UTC(y, m - 1, d, 12));
  return Date.UTC(y, m - 1, d, hh, mm) - off;
}

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/* Per-event measurements. rows: 5m [t,o,h,l,c] sorted. */
function measure(rows, events) {
  const idx = new Map(rows.map((r, i) => [r[0], i]));
  const eventDays = new Set(events.map((e) => e.date));
  const out = [];
  for (const e of events) {
    const T = eventTime(e.date, e.timeNY);
    const i0 = idx.get(T);
    if (i0 == null || !idx.has(T - 60 * MIN) || !idx.has(T + 240 * MIN)) continue;
    const at = (mins) => rows[idx.get(T + mins * MIN)];
    const open = rows[i0][1];
    const px = (mins) => { const r = at(mins - 5); return r ? r[4] : null; }; // close of the 5m bar ending at T+mins
    const hiLo = (a, b) => { let h = -Infinity, l = Infinity; for (let k = idx.get(T + a * MIN); k < idx.get(T + b * MIN); k++) { h = Math.max(h, rows[k][2]); l = Math.min(l, rows[k][3]); } return [h, l]; };
    // Baseline: same clock time on the previous 20 non-event weekdays.
    const base = [];
    for (let d = 1; base.length < 20 && d < 60; d++) {
      const t = T - d * 86400e3;
      const r = rows[idx.get(t)];
      const ds = new Date(t + S.nyOffset(t)).toISOString().slice(0, 10);
      if (r && !eventDays.has(ds)) base.push(r[2] - r[3]);
    }
    const [h15, l15] = hiLo(0, 15);
    const [h60, l60] = hiLo(0, 60);
    const [hPre, lPre] = hiLo(-30, 0);
    out.push({
      type: e.type, date: e.date, T, i0, year: +e.date.slice(0, 4),
      pre60: open - rows[idx.get(T - 60 * MIN)][1],
      first5Range: rows[i0][2] - rows[i0][3], baseRange: median(base),
      move5: px(5) - open, move15: px(15) - open, move60: px(60) - open, move240: px(240) - open,
      range15: h15 - l15, range60: h60 - l60, h15, l15, hPre, lPre,
    });
  }
  return out;
}

function summarize(ms) {
  const n = ms.length;
  const cont = ms.filter((m) => m.move15 !== 0 && Math.sign(m.move240 - m.move15) === Math.sign(m.move15)).length;
  const sameDir60 = ms.filter((m) => m.move15 !== 0 && Math.sign(m.move60) === Math.sign(m.move15)).length;
  return {
    n,
    volMultiple: median(ms.filter((m) => m.baseRange > 0).map((m) => m.first5Range / m.baseRange)),
    medFirst5Range: median(ms.map((m) => m.first5Range)),
    medAbs15: median(ms.map((m) => Math.abs(m.move15))), medAbs60: median(ms.map((m) => Math.abs(m.move60))), medAbs240: median(ms.map((m) => Math.abs(m.move240))),
    meanMove240: mean(ms.map((m) => m.move240)), up240: ms.filter((m) => m.move240 > 0).length / (n || 1),
    continuation: cont / (n || 1),       // after the first 15 min, did the next ~4h go the same way?
    holds60: sameDir60 / (n || 1),       // is price still on the same side after 1h?
    preDriftAbs: median(ms.map((m) => Math.abs(m.pre60))),
  };
}

// ---------- News trading rules ----------
function runTrade(rows, startIdx, endIdx, dir, entry, stop, target) {
  const risk = (entry - stop) * dir;
  if (!(risk > 0)) return null;
  for (let k = startIdx; k <= endIdx; k++) {
    const [, o, h, l] = rows[k];
    if (k > startIdx && (dir === 1 ? o <= stop : o >= stop)) return ((o - entry) * dir - NEWS_COST) / risk;
    if (dir === 1 ? l <= stop : h >= stop) return ((stop - entry) * dir - NEWS_COST) / risk;
    if (target != null && (dir === 1 ? h >= target : l <= target)) return ((target - entry) * dir - NEWS_COST) / risk;
  }
  return ((rows[endIdx][4] - entry) * dir - NEWS_COST) / risk;
}

const RULES = {
  follow: {
    label: 'Follow the first move',
    describe: (p) => `Wait ${p.wait} min after the release. Trade in the direction of that first ${p.wait}-min move; stop beyond its opposite extreme; target ${p.rr ? p.rr + 'R' : 'none'}; close after ${p.hold} min.`,
    grid: { wait: [5, 15, 30], rr: [1, 2, 3, 0], hold: [60, 240] },
  },
  fade: {
    label: 'Fade the first move',
    describe: (p) => `Wait ${p.wait} min after the release. Trade against that first move; stop beyond its extreme; target ${p.rr ? p.rr + 'R' : 'none'}; close after ${p.hold} min.`,
    grid: { wait: [5, 15, 30], rr: [1, 2, 3, 0], hold: [60, 240] },
  },
  straddle: {
    label: 'Pre-news range breakout',
    describe: (p) => `Mark the 30-min range before the release. Buy a break of its high or sell a break of its low (first one wins, filled at the worse of the level and the bar open); stop at the other side; target ${p.rr ? p.rr + 'R' : 'none'}; close after ${p.hold} min.`,
    grid: { rr: [1, 2, 3, 0], hold: [60, 240] },
  },
};

function tradeEvent(rows, idx, m, rule, p) {
  const T = m.T;
  if (rule === 'follow' || rule === 'fade') {
    const s = idx.get(T + p.wait * MIN), end = idx.get(T + p.hold * MIN);
    if (s == null || end == null) return null;
    let h = -Infinity, l = Infinity;
    for (let k = m.i0; k < s; k++) { h = Math.max(h, rows[k][2]); l = Math.min(l, rows[k][3]); }
    const first = rows[s - 1][4] - rows[m.i0][1];
    if (first === 0) return null;
    const dir = rule === 'follow' ? Math.sign(first) : -Math.sign(first);
    const entry = rows[s][1];
    const stop = floorStop(entry, dir === 1 ? l : h, dir);
    const risk = (entry - stop) * dir;
    return runTrade(rows, s, end, dir, entry, stop, p.rr ? entry + dir * p.rr * risk : null);
  }
  // straddle
  const end = idx.get(T + p.hold * MIN);
  if (end == null) return null;
  const hi = m.hPre, lo = m.lPre;
  for (let k = m.i0; k <= end; k++) {
    const [, o, h, l] = rows[k];
    const upHit = h > hi, dnHit = l < lo;
    if (!upHit && !dnHit) continue;
    const dir = upHit && dnHit ? (o - hi > lo - o ? 1 : -1) : upHit ? 1 : -1; // both in one bar: take the side nearer the open's gap
    const entry = dir === 1 ? Math.max(hi, o) : Math.min(lo, o);
    const stop = floorStop(entry, dir === 1 ? lo : hi, dir);
    const risk = (entry - stop) * dir;
    return runTrade(rows, k, end, dir, entry, stop, p.rr ? entry + dir * p.rr * risk : null);
  }
  return null;
}

function evalRule(rows, idx, ms, rule, p) {
  const rs = [];
  for (const m of ms) { const r = tradeEvent(rows, idx, m, rule, p); if (r != null) rs.push({ r, year: m.year, type: m.type, date: m.date }); }
  const n = rs.length, tot = rs.reduce((a, x) => a + x.r, 0);
  return { n, avgR: n ? tot / n : 0, totalR: tot, winRate: n ? rs.filter((x) => x.r > 0).length / n : 0, list: rs };
}

/* For each event type: choose the best rule+params on train events, report test events. */
function studyRules(rows, ms, isTrain) {
  const idx = new Map(rows.map((r, i) => [r[0], i]));
  const types = ['CPI', 'PPI', 'NFP', 'FOMC', 'ALL'];
  const out = {};
  for (const type of types) {
    const pick = (m) => type === 'ALL' || m.type === type;
    const train = ms.filter((m) => pick(m) && isTrain(m)), test = ms.filter((m) => pick(m) && !isTrain(m));
    const rows_ = [];
    for (const [rule, def] of Object.entries(RULES)) {
      for (const p of combos(def.grid)) {
        const tr = evalRule(rows, idx, train, rule, p);
        rows_.push({ rule, p, train: tr });
      }
    }
    // Robust pick: average R minus a penalty for small samples.
    rows_.forEach((r) => { r.score = r.train.n >= 15 ? r.train.avgR - 0.5 / Math.sqrt(r.train.n) : -Infinity; });
    rows_.sort((a, b) => b.score - a.score);
    const top = rows_.slice(0, 5).map((r) => ({ ...r, test: evalRule(rows, idx, test, r.rule, r.p) }));
    // Also show the simplest version of each rule family on both periods, for comparison.
    const families = Object.keys(RULES).map((rule) => {
      const best = rows_.find((r) => r.rule === rule);
      return { rule, p: best.p, train: best.train, test: evalRule(rows, idx, test, rule, best.p) };
    });
    out[type] = { trainEvents: train.length, testEvents: test.length, top, families };
  }
  return out;
}

module.exports = { eventTime, measure, summarize, studyRules, RULES, NEWS_COST };
