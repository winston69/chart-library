# HANDOFF — Candle interval, bucketing, and live-candle updates

Status: **resolved.** Completed in session 2026-10-24.

## The original problem

Three interacting issues:

1. The candle interval and the sliding window were the same
   duration (15 minutes each). Only one candle fit on screen.
2. The feeds emitted one row per tick, not one row per candle.
   Every tick drew a new candle instead of updating the current
   one.
3. `appendPoint` always pushed. There was no "replace the last
   row" path, so even with the right interval, the live candle
   kept accumulating as new rows.

## The target behavior

Standard trading chart semantics:

- Candle interval is a property of the chart (15-minute default),
  independent of the visible window.
- Zooming in or out does not change the candle interval. It
  changes how many candles are visible.
- Panning left reveals older candles.
- The current candle is *live*: its close/high/low/volume update
  on every tick. Only when the bucket closes does the candle
  freeze and a new one begin.

## The three constants, separated

In `chart-demo.js`:

```js
const BUCKET_MS = 900000;          // 15-minute candles
const WINDOW_MS = 86400000;        // 24-hour visible window
const VISUAL_UPDATE_MS = 1000;     // 1Hz tick cadence