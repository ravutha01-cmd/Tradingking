# TradingKing · ICT Setup Checklist (TradingView indicator)

A Pine Script v6 indicator that finds ICT-style reversal setups and scores each one with an 8-point checklist, plus a multi-timeframe bias table, session boxes, IRL levels, fair value gaps and an automatic entry / stop / target plan.

File: [`tk-ict-setup-checklist.pine`](tk-ict-setup-checklist.pine)

## Install

1. Open [TradingView](https://www.tradingview.com/chart/) and load a chart (e.g. **OANDA:XAUUSD**, 5m or 15m).
2. Open **Pine Editor** at the bottom of the screen.
3. Delete the template code, then paste the whole contents of `tk-ict-setup-checklist.pine`.
4. Click **Save**, then **Add to chart**.
5. Optional: open the indicator **Settings** (⚙) to change timeframes, session times or colours.

On the TradingView phone app, the Pine Editor isn't available. Add the script once from a computer; it then appears under **Indicators → My scripts** on your phone.

## What it draws

| On the chart | Meaning |
|---|---|
| **Bias table** (top right) | Bullish / Bearish for 15m, 1H, 4H, Daily. Bias turns bullish when that timeframe closes above its last swing high, bearish below its last swing low. Uses completed candles only. |
| **Session boxes** | Asia (8 PM–12 AM), London (2–5 AM), New York AM (9:30–11 AM), New York time. Their highs/lows are liquidity levels. |
| **$ London L**, **$ PDH** … | A liquidity sweep: a candle wicked through that level and closed back inside. |
| **MSS** | Market structure shift: after a sweep, a candle closed beyond the last internal swing. This creates the setup. |
| **IRL** (dotted) | Internal range liquidity: recent unbroken swing highs/lows. Removed once price trades through them. |
| **FVG** / **IFVG** boxes | Fair value gaps on the chart timeframe; an FVG that price closes through turns into an inversion FVG (IFVG). |
| **1H FVG** (dashed) | Higher-timeframe fair value gaps, used as points of interest and targets. |
| **Green / red boxes** | Entry (MSS close), stop (beyond the sweep wick) and target, with reward:risk and score. |
| **Setup Checklist** (bottom right) | ✅ / ❌ for the latest setup, its score out of 8, and whether a new sweep is waiting for an MSS. |

## The checklist

| # | Item | ✅ when |
|---|---|---|
| 1 | Liquidity Sweep | A session high/low, previous day high/low or internal swing was swept (always ✅ for a setup). |
| 2 | HTF POI Delivery | The sweep happened at a higher-timeframe point of interest: the previous day high/low or a 1H FVG. |
| 3 | MSS Confirmed | A candle closed beyond the last internal swing within 20 bars of the sweep (always ✅ for a setup). |
| 4 | Macro Window | The sweep or MSS happened in an ICT macro window (NY time): 2:33–3:00, 4:03–4:30, 8:50–9:10, 9:50–10:10, 10:50–11:10, 11:50–12:10, 13:10–13:40, 15:15–15:45. |
| 5 | Equilibrium | Long entry in the discount half (or short entry in the premium half) of the last 50 bars' range. |
| 6 | Volume Influx | Volume between sweep and MSS reached 1.5 × its 20-bar average. |
| 7 | IFVG | An opposing FVG was closed through during the move (bearish FVG inverted for longs, bullish for shorts). |
| 8 | Clear Targets | Unbroken liquidity (IRL, session high/low, previous day high/low, HTF FVG) sits at least 2R away. That level becomes the target. |

All thresholds are adjustable in the settings.

## Alerts

Create an alert on the indicator and choose **Any alert() function call**. It fires when a setup scores at least **"Alert when score ≥"** (default 6/8), with the entry, stop and target in the message. Separate **TK ICT long setup** / **TK ICT short setup** conditions are also available.

## Notes

- Signals are confirmed on candle close and do not repaint. HTF bias and HTF FVGs use completed higher-timeframe candles only.
- Best on 1–15 minute charts. Macro windows only line up on low timeframes, and the HTF FVG timeframe should be above the chart timeframe.
- Volume on forex/CFD gold is tick volume from the broker, so the volume check is approximate.
- The checklist describes how textbook a setup is; it has **not been backtested** and a high score is not a guarantee. Educational use only — not financial advice.

---

# TradingKing · XAUUSD 100-pip strategy (TradingView strategy)

File: [`tk-100pip-strategy.pine`](tk-100pip-strategy.pine) — the fixed **100-pip stop / 300-pip take profit** strategy from the Desk (gold pip = $0.10, so SL $10, TP $30).

**Rule (Oct 2026 rule set, re-chosen quarterly by `scripts/research/fixed-sltp.js`):** on the 15-minute chart, during London + New York hours (2 AM – noon NY), buy when price is above the 50 EMA and RSI(2) drops below 10 — only if the last completed 4H candle is in an uptrend (close > EMA50 > EMA200). Sells are the mirror image. One trade at a time; exit at SL, TP or after 48 hours.

**Install:** Pine Editor → paste → Save → *Add to chart* on XAUUSD 15m. Open the **Strategy Tester** tab to see how it did on your broker's prices.

**Alerts with entry, SL and TP:** *Create alert* → condition: *TK 100-pip* → **"alert() function calls only"** → enable *Notify on app*. Each alert reads like: `XAUUSD BUY (TK 100-pip) · entry ≈ 4152.30 · SL 4142.30 (100 pips) · TP 4182.30 (300 pips)`.

**Honest results** (walk-forward, $0.40 cost, 1% risk per trade): unseen 2023–25 **+102%** with a 28% max drawdown; **2026 +2%** (28% winners). A fixed $10 stop is tight for 2026 gold, where a 15-minute candle often moves $5–10 — risk 0.5% per trade or less. Not financial advice.
