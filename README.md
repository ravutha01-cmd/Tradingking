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
- **5-a-Day Signals** (`signals.html`): about 5 live XAUUSD signals per day from walk-forward tested rules (+12.4% in 2026 at 0.25% risk per trade), with open positions, today's signals, combined risk, sound/desktop alerts, yearly results and cost sensitivity. See [5 signals a day](#5-signals-a-day).
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

`scripts/research/walkforward.js` builds the 5-a-day rule set **walk-forward**: every January the rules are re-chosen using only earlier data, then traded for that year. The pool is 1,864 rule settings on 15m, 30m, 1H and 4H charts (five families × higher-timeframe trend filter × London/NY session filter × day-trade vs overnight). A rule qualifies if it was profitable in 3 of 4 slices of the selection data, earned > 0.02R per trade after $0.40 costs, and had a drawdown ≤ 25%; the best-ranked rule of each chart/family is added until the selection data shows 5 signals per day.

Eight selection methods (ranking × lookback × minimum edge) were compared on the out-of-sample years 2023–2025; the best (return ÷ drawdown, all history, ≥ 0.02R) was then checked on 2026, which was not used to choose it:

| 0.25% risk per trade | Rules chosen on | Signals/day | Win rate | Return | Max DD | Positive months |
|---|---|---|---|---|---|---|
| 2023 | Aug 2020 – Dec 2022 | 8.5 | 62% | +4.5% | 5.2% | 6/13 |
| 2024 | Aug 2020 – Dec 2023 | 5.4 | 68% | +16.3% | 2.0% | 11/12 |
| 2025 | Aug 2020 – Dec 2024 | 5.3 | 66% | +7.4% | 6.5% | 9/12 |
| **2026** | Aug 2020 – Dec 2025 | **5.4** | 58% | **+12.4%** | 6.3% | 6/10 |
| **2023 → now** | | 6.2 | | **+46.7%** | 6.5% | 32/46 |

The 2026 rules (live on `signals.html`): 1H RSI(2) pullback with the 4H trend, 30m RSI(2) pullback with the 1H trend, 30m Bollinger reversion with the 4H trend, and Donchian breakouts on 15m, 30m, 1H (with the 4H trend, London/NY session) and 4H. Costs matter: 2023 → now is +76% at $0.20 per trade, +22% at $0.60, break-even ≈ $0.80. The rules often fire together, so combined risk can reach ~1%.

A simpler single split (`intraday.js`: chosen on 2020–24) gave +8.1% on 2025–26 but only +0.7% in 2026; an attempt using 5m/15m charts without the drawdown cap lost 46% on 2025–26.

Regenerate (≈ 3 min download + 20 s):

```bash
NODE_USE_ENV_PROXY=1 node scripts/research/fetch-5m.js   # 5m candles → data/cache (not committed)
node scripts/research/run.js                             # → data/research/report.json, js/research-data.js
node scripts/research/walkforward.js                     # → js/intraday-data.js (live 5-a-day rules, walk-forward)
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
js/signals5.js      5-a-Day Signals page (live signals from the three rules)
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
