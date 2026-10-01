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

Unit tests cover the indicators (SMA, EMA, RSI, ATR) and the signal engine's buy/sell output.

## Project layout

```
index.html          page layout
css/style.css       styles (dark theme, responsive)
js/indicators.js    SMA, EMA, RSI, MACD, ATR, Bollinger Bands
js/signals.js       scoring + trade plan
js/data.js          Binance WebSocket feed / Twelve Data polling feed
js/app.js           UI, TradingView widgets, history, alerts
tests/              node:test unit tests
```

## Disclaimer

Signals are generated automatically from technical indicators and are for **educational purposes only — not financial advice**. Trading gold (especially with leverage) carries a high risk of loss. Always do your own analysis and use proper risk management.
