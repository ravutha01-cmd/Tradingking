#!/usr/bin/env node
/* Downloads (or tops up) all 5-minute PAXG/USDT candles into data/cache/paxg-5m.json.
 * Compact format: [[openTime, open, high, low, close], ...]. Not committed (≈ 35 MB). */
const fs = require('fs');
const path = require('path');
const History = require('../../js/history.js');

const file = path.join(__dirname, '../../data/cache/paxg-5m.json');

(async () => {
  let rows = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const since = rows.length ? rows[rows.length - 1][0] + 300e3 : 0;
  let n = 0;
  const fresh = await History.fetchRange('5m', since, (t) => { if (++n % 50 === 0) console.log('…', new Date(t).toISOString()); });
  rows = rows.concat(fresh.filter((c) => c.closed).map((c) => [c.time, c.open, c.high, c.low, c.close]));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rows));
  console.log(`saved ${rows.length} candles → ${new Date(rows.at(-1)[0]).toISOString()}`);
})().catch((e) => { console.error(e); process.exit(1); });
