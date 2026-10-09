# 👑 TradingKing — XAUUSD Signals

A static web app that shows **live XAUUSD (gold) trading signals**: it streams live candles, runs an indicator-based signal engine in the browser, and displays the TradingView live chart and technical rating alongside it.

## Features

- **Live TradingView chart** (`OANDA:XAUUSD`) with EMA, RSI and MACD studies.
- **TradingView technical rating** widget (TradingView's own buy/sell gauge).
- **Signal engine**: STRONG BUY / BUY / NEUTRAL / SELL / STRONG SELL from a score of
  - price vs EMA200 (long-term trend)
  - EMA21 vs EMA50 (medium trend)
  - EMA9/21 crossover (recent crosses weigh double)
  - MACD histogram momentum
  - RSI 14 (bullish/bearish zones, overbought/oversold)
  - Bollinger Band extremes
- **Trade plan**: entry, ATR-based stop loss (adjustable × ATR), TP1/TP2/TP3 at 1R/2R/3R.
- **Multi-timeframe scan**: 5m, 15m, 1H, 4H, 1D, refreshed every minute.
- **Signal history**: new BUY/SELL signals are logged on candle close (saved in the browser).
- **Alerts**: optional sound and desktop notification when a new signal appears.
- Timeframes: 1m, 5m, 15m, 1H, 4H, 1D.
- **Trading Desk** (`index.html`, the home page): one screen for "what should I do now" — live signal cards from the official 5-a-day rules with entry/stop/target and a **position size** (lots and $ at risk from your balance, risk %, contract size and spread), open positions with live R and $ and combined risk, a multi-timeframe trend strip, a countdown to the next CPI/PPI/NFP/FOMC release with a release-window warning, and the live forward-test record next to the backtest. Every page shares the same navigation (a bottom tab bar on phones) and news countdown. The older indicator dashboard is now `momentum.html` ("Chart"), labelled as a momentum read, not a trade signal.
- **100-pip strategy** (Desk panel + `tradingview/tk-100pip-strategy.pine`): fixed **stop loss 100 pips, take profit 300 pips** (gold pip = $0.10), with entry / SL / TP shown live in price and pips and sound/desktop alerts on the Desk, plus a TradingView strategy that sends phone alerts with the levels. See [100-pip strategy](#100-pip-strategy).
- **5-a-Day Signals** (`signals.html`): about 5 live XAUUSD signals per day from walk-forward tested rules re-chosen monthly (+19.5% in 2026 at 0.25% risk per trade, #1 of 12 consistent ~5/day approaches), with open positions, today's signals, combined risk, sound/desktop alerts, yearly results and cost sensitivity. See [5 signals a day](#5-signals-a-day).
- **Research** (`research.html`): live analysis on every timeframe (15m → weekly), the best-tested strategy for 2026 with live status, every strategy × timeframe result, and CPI / PPI / NFP / FOMC news behaviour with an upcoming-release calendar. See [Research](#research-xauusd-2026).
- **TradingView indicator** (`tradingview/`): ICT Setup Checklist — bias table, sessions, liquidity sweeps, MSS, IRL, FVG/IFVG, 8-point checklist, entry/stop/target and alerts. See [tradingview/README.md](tradingview/README.md).
- **CRT 4H Lab** (`crt.html`): Candle Range Theory strategy with recorded history, backtest, training and a live signal journal (see below).

## CRT 4H strategy (Candle Range Theory)

On the 4H chart, candle 1 (C1) sets a range. Candle 2 (C2) **sweeps** one side of it and then **closes back inside**:

- **Bearish CRT:** C2 trades above C1 high and closes back below it → SELL at C2 close, stop above the C2 wick, target the middle or low of C1.
- **Bullish CRT:** C2 trades below C1 low and closes back above it → BUY at C2 close, stop below the C2 wick, target the middle or high of C1.

**Candles are New York-aligned**, like OANDA:XAUUSD on TradingView: 4H candles open at 5 PM, 9 PM, 1 AM, 5 AM, 9 AM and 1 PM New York time (daylight saving handled), the trading day runs 5 PM → 5 PM NY, and the weekend (Fri 5 PM → Sun 5 PM NY) is removed. Binance's own 4H candles start at 00:00 UTC, so the lab records **1H** candles and builds the NY 4H candles from them.

**Optional filters:**

- **Session** — only take a CRT when C2 (the sweep candle) is one of: the key CRT candles (1 AM, 5 AM, 9 AM NY), London (1 AM, 5 AM), New York (9 AM, 1 PM) or Asia (5 PM, 9 PM).
- **Higher-timeframe bias** — only trade in the direction of the previous daily candle, the daily close vs daily EMA20, or the previous weekly candle.
- **Premium / discount** — buy only below the previous day's midpoint, sell only above it.

Only completed daily/weekly candles are used (no look-ahead).

The **CRT 4H Lab** page:

1. **Records data:** downloads every 1H gold candle since Aug 2020 (~53,000, about 25 s the first time), saves them in your browser (~2 MB), and adds new ones every minute. You can download the NY 4H candles as a CSV.
2. **Live setup:** shows the current CRT signal, the C1 range the forming candle is sweeping, the current NY session, the daily/weekly bias, the premium/discount zone and which direction the active settings allow right now.
3. **Trains:** tests 17,280 rule combinations (range size, sweep depth, EMA trend filter, target, stop buffer, minimum reward:risk, holding time, session, higher-timeframe bias, premium/discount), including a trading cost per trade. It also trains once without the session/bias filters and shows a one-at-a-time filter breakdown, so you can see whether they help. Settings are picked **only on the older data** (default 70%), scored on how consistently they profit across 4 slices of it, then **tested on the newest data they never saw**. The verdict box says whether they passed.
4. **Backtest:** stats and equity curve for the active settings, with the train/test split marked.
5. **Signal journal:** records every live CRT signal from the day you start and tracks whether it hit the target, the stop, or the time limit.

The dashboard also has a small CRT 4H card using the same settings.

### Training results so far (6 Oct 2026, NY-aligned 4H, $0.40 cost per trade, test period Dec 2024 → Oct 2026)

| | Train avg / trades | **Test avg / trades** |
|---|---|---|
| Plain CRT (default settings, all data) | −0.12R / 662 (all data) | |
| Trained **without** session / bias filters | +0.02R / 563 | **−0.12R / 261** |
| Trained **with** session / bias filters | +0.16R / 60 (92% win) | **−0.16R / 27** |

Filter breakdown on the test period (best settings, one option swapped at a time):

| Session of C2 | Test avg / trades | | HTF bias | Test avg / trades |
|---|---|---|---|---|
| All | −0.08R / 104 | | Off | −0.21R / 50 |
| Key 1/5/9 AM NY | −0.07R / 60 | | Previous day | −0.16R / 27 |
| London | −0.17R / 42 | | Daily EMA20 | −0.21R / 45 |
| New York | +0.08R / 38 | | Previous week | −0.19R / 32 |
| Asia | −0.16R / 27 | | | |

**Session times and higher-timeframe bias did not make CRT profitable on unseen data.** They improved the training numbers (fewer, cleaner trades) but every one of the top 10 settings lost on the test period, which is the signature of overfitting. The key 1/5/9 AM candles performed about the same as trading every session. The New York session was the only positive test result, but it lost in training, so choosing it now would be picking with hindsight — watch it in the journal instead. Use the journal to forward-test before trusting any signal.

Retrain from the command line (also refreshes the built-in settings used by the site):

```bash
npm run train      # writes data/xauusd-4h-ny.csv, data/crt-report.json, js/crt-trained.js
```

## Data feeds

| Feed | Key needed | Notes |
|------|-----------|-------|
| **Gold – PAXG/USDT (Binance)** *(default)* | No | Real-time WebSocket stream. PAXG is a token backed 1:1 by a troy ounce of LBMA gold, so it tracks spot XAU/USD closely (usually within a few dollars). |
| **Spot XAU/USD (Twelve Data)** | Free key from [twelvedata.com](https://twelvedata.com) | True spot price, polled every 60 s (free plan: 8 req/min, 800/day). The multi-timeframe scan stays on Binance to save credits. |

TradingView widgets cannot hand their price data to other scripts, so the signal engine uses these feeds while the chart and rating come from TradingView.

## Research (XAUUSD 2026)

`research.html` is built from a study of every 5-minute gold candle since Aug 2020 (642,000 candles, Binance PAXG/USDT) and 297 official US release dates (BLS archives for CPI, PPI and the jobs report; federalreserve.gov for FOMC — `data/events/us-macro-events.json`).

**Method.** Five strategy families (EMA trend, Donchian breakout, RSI trend pullback, Bollinger mean reversion, Asia-range breakout) × four timeframes (15m, 1H, 4H, daily), every combination of settings, $0.40 cost per trade, next-candle fills, minimum stop 0.05% of price. Settings are chosen on **Sep 2020 – Dec 2024 only** and must be profitable in 3 of 4 slices of it; **2025–2026 is the unseen test**.

**Results (Oct 2026):**

| | 2020–24 (training) | 2025–26 (test) | 2026 so far |
|---|---|---|---|
| **Trend portfolio** — 1H RSI pullback + 4H EMA crossover + 4H Donchian, 0.33% risk each | +46%, max DD 4% | **+22%, max DD 4%** | +4.3% |
| Buy & hold gold (full position) | +35% | +58% (DD 30%) | −4% |
| First pick by Sharpe — 15m Bollinger mean reversion | +2309%, DD 64% | **−80%** | −47% |

- Trend-following worked in 2025–26 because gold trended hard (to ~$5,630 in Jan 2026); mean reversion broke down. The drawdown cap that excludes the failed first pick was added after seeing that failure — treat the portfolio's test result with some caution.
- **News:** the first 5 minutes after CPI, NFP and FOMC are ~4× wider than normal (PPI 2×); typical 4-hour moves in 2026 are $14 (CPI), $21 (PPI), $34 (NFP), $80 (FOMC). The direction of the first 15 minutes continues only 44–57% of the time — a coin flip. The best tested rule (trade the first break of the 30-min pre-release range) made +0.12R per trade in training and +0.25R over 74 releases in 2025–26, but was negative for CPI and FOMC alone. Forecast-vs-actual ("surprise") data is not included.

### 5 signals a day

The live 5-a-day system is chosen **walk-forward and re-chosen every month** (`scripts/research/adaptive.js`, run automatically on the 1st by `.github/workflows/monthly-reselect.yml`):

- **Rule pool:** 1,864 rule settings on 15m, 30m, 1H and 4H charts (EMA trend, Donchian breakout, RSI(2) pullback, Bollinger reversion, Asia-range breakout × higher-timeframe trend filter × London/NY session × day-trade vs overnight), each backtested with $0.40 costs per trade.
- **Selection (data before the 1st of the month only):** keep rules profitable in 3 of 4 slices of the selection data with a drawdown ≤ 25%, rank them, and add the best rule of each chart/family until the rule set reaches ~5 signals/day.
- **Adaptive:** eight ranking methods exist (return ÷ DD or edge per trade × all history or last 2 years × minimum edge 0.02R or 0.05R); each month the system uses the one whose own out-of-sample trades over the previous 12 months had the best return ÷ drawdown, among methods reaching ≥ 4.5 signals/day.
- **How this was chosen:** 27 variants (8 methods × yearly/quarterly/monthly re-selection + adaptive) were compared on out-of-sample 2023–2025 only; 2026 is the check.

| 0.25% risk per trade | Signals/day | Win rate | Return | Max DD | Positive months |
|---|---|---|---|---|---|
| 2023 | 6.0 | 63% | +6.8% | 4.1% | 8/13 |
| 2024 | 5.4 | 68% | +16.3% | 2.0% | 11/12 |
| 2025 | 5.4 | 64% | +36.8% | 5.5% | 10/13 |
| **2026 (Jan 1 – Oct 8)** | **5.4** | 58% | **+19.5%** | 6.2% | 7/10 |
| **2023 → now** | 5.6 | | **+103%** | 6.2% | 35/46 |

**Is it the best for 2026?** (`scripts/research/benchmark-2026.js`) Among the 12 approaches that delivered ~5 signals/day (4.5–7) in both 2023–25 and 2026 — every walk-forward variant, the earlier versions and random trading — it ranks **#1 in 2026** by return ÷ drawdown. The six approaches ranked above it overall trade fewer than 4.5 times a day or lost money in 2023–25. Against 500 random traders with the same frequency, stops, holding time and costs it beats 91% in 2026 and **all 500 from 2023 to now** (+103% vs a median of −44%, best −9.7%). Costs: 2023 → now is +138% at $0.20 per trade, +73% at $0.60 and +48% at $0.80.

**Tested and rejected (Oct 2026, `scripts/research/experiments/improvements.js`):** a ±30/±60-minute news blackout, a cap on same-direction positions (1–3), a 1H volatility-regime filter and edge-scaled position sizing. The adoption rule, set before running, was a ≥ 10% better 2023–25 return ÷ drawdown with 4.5–7 signals/day; none passed (best: news ±30 min, +3%), so the live system is unchanged. The Desk's release warning is therefore advice about spreads and spikes, not a rule.

Earlier versions, kept for comparison: yearly re-selection (+12.4% in 2026), a single 2020–24 split (+0.7% in 2026), and a 5m/15m-only attempt without the drawdown cap (−46% on 2025–26).

**Forward test.** `.github/workflows/forward-test.yml` runs `scripts/forward/log.js` every hour: each live signal since 8 Oct 2026 is saved to `data/forward/signals.json` with the time it was first seen, its result is filled in when it closes, and the change is committed — the commit history is a timestamped record. Rules retired by the monthly re-selection keep being tracked until their open trades close; new rules only record signals after they go live. Disable either workflow in the repository's Actions tab to stop it.

### 100-pip strategy

`scripts/research/fixed-sltp.js` tests every entry rule (EMA cross, Donchian breakout, RSI(2) pullback, Bollinger reversion, Asia-range breakout) on 5m, 15m, 30m and 1H charts — with optional 1H/4H trend filter, London+NY session, day-trade close and 8h/48h time limit — using a **fixed 100-pip ($10) stop** and a **150 / 200 / 250 / 300-pip take profit**: 4,048 rules, $0.40 cost per trade. The rule is chosen walk-forward (a rule must be profitable in 3 of 4 slices of the selection data, > 0.05R per trade, drawdown ≤ 25%); 12 selection methods (all history / 2 years / 12 months / 6 months × yearly / quarterly / monthly re-selection) were compared on unseen 2023–25, and the best, **quarterly re-selection on all history**, is live:

| 1% risk per trade | Return | Max DD | Win rate | Trades |
|---|---|---|---|---|
| 2023–25 (unseen) | +102% | 28% | 45% | 950 |
| **2026 (to Oct 9)** | **+2.0%** | 13.4% | 28% | 95 |

Current rule (chosen Oct 1, 2026): **15m RSI(2) pullback** — buy when price is above EMA50 and RSI(2) < 10, only with the 4H uptrend and in London/NY hours (sells mirrored); SL 100 pips, TP 300 pips (1 : 3), max 48 h. **A fixed $10 stop is tight for 2026 gold** (a 15-minute candle often moves $5–10), which is why 2026 is roughly flat while earlier, calmer years were strongly positive; shorter look-backs did not fix it (6-month selection lost 20–49% in 2026). Risk 0.5% per trade or less. Cost: 2023–25 is +145% at $0.20 and +38% at $0.80 per trade. Re-chosen automatically by the monthly workflow.

Regenerate (≈ 3 min download + 20 s):

```bash
NODE_USE_ENV_PROXY=1 node scripts/research/fetch-5m.js   # 5m candles → data/cache (not committed)
node scripts/research/run.js                             # → data/research/report.json, js/research-data.js
node scripts/research/adaptive.js                        # → js/intraday-data.js (live 5-a-day rules, re-chosen monthly)
node scripts/research/benchmark-2026.js                  # 2026 comparison + random traders
node scripts/research/fixed-sltp.js                      # → js/sltp-data.js (100-pip SL strategy, ≈ 2 min)
```

## Run it

The app is plain HTML/CSS/JS, with no build step.

```bash
npm start          # serves the folder at http://localhost:8080
# or
python3 -m http.server 8080
```

You can also open `index.html` directly, or host it on GitHub Pages, Netlify or similar.

## Tests

```bash
npm test
```

Unit tests cover the indicators, the signal engine, NY session times / candle building, and the CRT detector, filters, trade simulation, journal and optimizer.

## Project layout

```
index.html          dashboard
crt.html            CRT 4H Lab
css/style.css       styles (dark theme, responsive)
js/indicators.js    SMA, EMA, RSI, MACD, ATR, Bollinger Bands
js/signals.js       scoring + trade plan
js/data.js          Binance WebSocket feed / Twelve Data polling feed
js/app.js           dashboard UI, TradingView widgets, history, alerts
js/crt.js           CRT detection, backtest, optimizer, journal
js/sessions.js      New York time, sessions, NY-aligned 4H candles
js/history.js       1H candle recorder (Binance, saved in the browser)
js/crt-lab.js       CRT Lab UI
js/crt-trained.js   built-in trained CRT settings (generated)
js/engine.js        live engine for the official rules (candle cache, open positions, new signals)
js/ui.js            shared UI: navigation, news countdown/banner, position sizing, alerts
js/desk.js          Trading Desk page
js/events-data.js   US release calendar for the countdown (scripts/build-events.js)
js/signals5.js      5-a-Day Signals page
js/intraday-data.js 5-a-day walk-forward results and live rules (generated)
js/research.js      Research page UI (live multi-timeframe analysis, strategy status, news)
js/research-data.js research results (generated)
scripts/research/   5m download, strategy backtester, news event study
scripts/train-crt.js  command-line training
data/               recorded NY 4H history (CSV) and training report
tests/              node:test unit tests
```

## Disclaimer

Signals are generated automatically from technical indicators and are for **educational purposes only — not financial advice**. Trading gold (especially with leverage) carries a high risk of loss. Always do your own analysis and use proper risk management.
