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
- **CRT 4H Lab** (`crt.html`): Candle Range Theory strategy with recorded history, backtest, training and a live signal journal (see below).

## CRT 4H strategy (Candle Range Theory)

On the 4H chart, candle 1 (C1) sets a range. Candle 2 (C2) **sweeps** one side of it and then **closes back inside**:

- **Bearish CRT:** C2 trades above C1 high and closes back below it → SELL at C2 close, stop above the C2 wick, target the middle or low of C1.
- **Bullish CRT:** C2 trades below C1 low and closes back above it → BUY at C2 close, stop below the C2 wick, target the middle or high of C1.

The **CRT 4H Lab** page:

1. **Records data:** downloads every 4H gold candle since Aug 2020 (~13,000), saves them in your browser, and adds new ones every minute. You can download them as a CSV.
2. **Live setup:** shows the current CRT signal and the C1 range the forming candle is sweeping.
3. **Trains:** tests 7,776 rule combinations (range size, sweep depth, close depth, EMA trend filter, target, stop buffer, minimum reward:risk, holding time, weekend filter), including a trading cost per trade. Settings are picked **only on the older data** (default 70%), scored on how consistently they profit across 4 slices of it, then **tested on the newest data they never saw**. The verdict box says whether they passed.
4. **Backtest:** stats and equity curve for the active settings, with the train/test split marked.
5. **Signal journal:** records every live CRT signal from the day you start and tracks whether it hit the target, the stop, or the time limit.

The dashboard also has a small CRT 4H card using the same settings.

### Training results so far (Oct 2026, PAXG/USDT 4H, $0.40 cost per trade)

| | Trades | Win rate | Avg per trade |
|---|---|---|---|
| Plain CRT (default settings, all data) | 847 | 33% | −0.13R |
| Trained settings, training period | 41 | 73% | +0.37R |
| Trained settings, **unseen test period** | 26 | 46% | **−0.06R** |

**The training has not found a CRT version that is reliably profitable.** Training improves the old data a lot, but the improvement mostly disappears on new data, which is the signature of overfitting. The two findings that held across the top settings: only trading **with the trend** (EMA50/EMA200 filter) and using a **wider stop** (0.5× ATR beyond the wick) did better. Use the journal to forward-test before trusting any signal.

Retrain from the command line (also refreshes the built-in settings used by the site):

```bash
npm run train      # writes data/paxg-4h.csv, data/crt-report.json, js/crt-trained.js
```

## Data feeds

| Feed | Key needed | Notes |
|------|-----------|-------|
| **Gold – PAXG/USDT (Binance)** *(default)* | No | Real-time WebSocket stream. PAXG is a token backed 1:1 by a troy ounce of LBMA gold, so it tracks spot XAU/USD closely (usually within a few dollars). |
| **Spot XAU/USD (Twelve Data)** | Free key from [twelvedata.com](https://twelvedata.com) | True spot price, polled every 60 s (free plan: 8 req/min, 800/day). The multi-timeframe scan stays on Binance to save credits. |

TradingView widgets cannot hand their price data to other scripts, so the signal engine uses these feeds while the chart and rating come from TradingView.

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

Unit tests cover the indicators, the signal engine, and the CRT detector, trade simulation, journal and optimizer.

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
js/history.js       4H candle recorder (Binance, saved in the browser)
js/crt-lab.js       CRT Lab UI
js/crt-trained.js   built-in trained CRT settings (generated)
scripts/train-crt.js  command-line training
data/               recorded 4H history (CSV) and training report
tests/              node:test unit tests
```

## Disclaimer

Signals are generated automatically from technical indicators and are for **educational purposes only — not financial advice**. Trading gold (especially with leverage) carries a high risk of loss. Always do your own analysis and use proper risk management.
