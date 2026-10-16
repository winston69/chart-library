# SESSION

Project: multi-band chart library + demo.
Last update: 2026-10-16.

## Purpose of this file

If a working session is interrupted, this file is the source of
truth for architectural decisions and open work. Paste it into a
new session along with the repo URL to resume.

The repo itself is the source of truth for what the code *is*.
This file explains what the code *means* and where it's going.

---

## State

- Four bands, bottom to top: volume, RSI, price, MACD.
  Top to bottom: MACD, price, RSI, volume.
- All layers are primitive: one class, one visual concept.
- The plane handles slots, y-groups, layout, margins, and domain
  union. It knows nothing about specific indicators.
- Indicators are composed in the application, not baked into
  layer classes.
- Indicators are classes extending `BaseIndicator`. Each has a
  matching pure-math computer in a `*.calc.js` file that runs
  in the worker.
- The worker computes indicators; the main thread renders.
  No DOM imports enter the worker's import graph.

## Layer inventory

Primitives:
- `Line`         — polyline through data. Contributes to domain.
- `Area`         — fill under a Line down to a baseline. No domain.
- `Points`       — circles at each sample. No domain.
- `GhostLine`    — dashed unclipped polyline. No domain.
- `BandFill`     — fill between two source layers. No domain.
- `BarChart`     — bars, up/down coloring, baseline-configurable.
- `CandleStick`  — wicks + bodies.
- `ReferenceLine`— horizontal/vertical annotation with pulse.
- `Axis` / `XAxis` / `YAxis` — ticks, labels, grid.
- `CrosshairLayer`, `InteractionLayer` — pointer behaviors.

Card layers (HTML overlay): `CardStrip`, `Legend`, `OHLCCard`, `InfoCard`.
UI layers: `Button`, `ToolBar`, `ToolTip`.

Indicator classes (main-thread rendering):
- `BaseIndicator` — base class owning layer list, dispatch.
- `MACD`         — histogram + MACD line + signal line.
- `RSI`          — RSI line + 70/30 level lines.
- `Bollinger`    — fill + lower/upper/mean lines.
- `SMA`          — simple moving average line.
- `VWMA`         — volume-weighted moving average line.
- `Volume`       — volume bars, colored by candle direction.

Indicator computers (worker-side, pure math):
- `MACD.calc.js`      — `createMACDCalc`
- `RSI.calc.js`       — `createRSICalc`
- `Bollinger.calc.js` — `createBollingerCalc`
- `SMA.calc.js`       — `createSMACalc`
- `VWMA.calc.js`      — `createVWMACalc`

## Architectural rules

1. One layer, one visual primitive. Composition happens in the
   application, not in a class.
2. JS writes geometry, behavior, and content. CSS writes
   appearance (color, stroke, width, dash, opacity, font-size,
   radius).
3. Numeric CSS variables that feed JS math are read once in the
   constructor via `CSS.getNumber('--variable')`. No caches, no
   fallbacks. A missing variable throws with the variable name.
4. Every layer's CSS file declares its numeric defaults in a
   `:root` block so they're readable before any group exists.
5. Class names live in `CSS.js`. Layers import `CSS.<layer>` and
   use the strings; nothing else knows the raw class names.
6. Indicator classes extend `BaseIndicator`. They own their
   layers, register them with the plane, and expose a uniform
   handle contract (`appendPoint`, `updateLastPoint`,
   `appendOrUpdate`, `setData`, `remove`).
7. Indicator computers are factories returning stateful objects
   with `compute(row)`, `snapshot()`, `restore(snap)`, `reset()`.
   They have zero imports — no DOM, no dependency on the
   indicator classes.
8. The worker's registry (`indicators.js`) imports only
   `*.calc.js` files. Adding a new indicator requires editing
   this one file to add the import and a `COMPUTERS` entry.
9. The `snapshot`/`restore` pair lets the worker recompute the
   open bucket from a bucket-start snapshot on every tick, so
   indicator values during a forming bucket are a pure function
   of (state at open, current input). No drift.

## Recent cleanups

### Session 2026-10-16

- Introduced `BaseIndicator` as the base class for all
  rendering indicators. Owns `layers`, `group`, `primaryLayer`,
  and dispatch (`appendPoint`, `updateLastPoint`,
  `appendOrUpdate`, `setData`, `remove`).
- Converted `createMACD`/`createRSI`/`createBollinger` from
  factory functions to classes: `MACD`, `RSI`, `Bollinger`.
  Same option surface; `new MACD({...})` instead of
  `createMACD({...})`.
- Added `SMA`, `VWMA`, `Volume` indicator classes.
- Moved computers out of `indicators.js` into per-indicator
  `*.calc.js` files. Renamed `createXComputer` → `createXCalc`.
- `indicators.js` is now a thin registry: imports each
  `createXCalc`, exports `COMPUTERS` and `createIndicatorSet`.
- `createIndicatorSet` now accepts entries as either a string
  or `{ name, ...params }`. Shared params (like `bucketMs`) are
  passed as a second argument and merged into each entry.
- `compute(row)` contract: computers receive the whole row and
  read the fields they need. Registry forwards the row.
- Layers now trim at `this._windowSize` (set by the plane to
  `maxData`), not at `plane.windowSize`.
- `CartesianPlane` gained `maxData` (retention cap) and
  `padding` (right-gap fraction) options.
- `domainStrategy` default is now `expanding`, not `static`.
  `expanding` fits all data left-justified with a right pad.
- Demo uses `padding: 0.05`, `maxData: 7 days`,
  `windowSize: 24h`.
- Axes now render into margin slots (`Axis.slot = 'margin'`),
  not `plot-area`. Layout unchanged; structurally correct and
  unblocks future plot-area clipping.
- `ReferenceLine._renderLabel` measures text with
  `getComputedTextLength()` instead of `text.length * 6`, so
  the flip decision is accurate. Falls back to an estimate
  (`text.length * labelFontSize * 0.6`) on the first frame
  after a text change.
- `ReferenceLine` reads `--ref-font-size` from CSS via
  `CSS.getNumber` once in the constructor.
- Crosshair snap dot is now a `<g>` containing a core dot plus
  three animated rings, matching the ReferenceLine pulse
  structure. Positioned via `transform: translate(x, y)`.
- Crosshair and ReferenceLine share pulse animations
  (duplicated keyframes in each CSS file), the same amber color
  (`#fbbf24`), the same dark rim (`rgba(15, 15, 15, 0.6)`,
  `1px`), and the same seamless-looping keyframes (1 → 1.4 → 1
  for the core; 0.8 → 3 for rings).
- `CSS.crosshair` gained `snapGroup` and `snapRing` keys.

### Earlier

- Split LineChart into Line, Area, Points.
- Extracted GhostLine and BandFill as standalone layers.
- Removed Pointer.js; SVG.getPoint and SVG.pointInBounds on SVG.
- Removed Axis.js compat shim; AxisLayer renamed to Axis.
- Removed CartesianPlane._getSvgPoint; consumers call SVG.getPoint.
- CSS.js trimmed to class maps + get/getNumber.
- Utils.js trimmed to functions with active callers.
- Added core/Icons.js: SVG icon registry with currentColor theming.
- Migrated toolbar icons from emoji to SVG.
- Flattened toolbar buttons: square, no borders, no gaps.
- Fixed Button.setIcon to rebuild icon node on change.
- Extracted indicator computation from chart-demo-feed.js into
  demo/indicators.js (createIndicatorSet) — since superseded by
  the `*.calc.js` split.
- Band stack bottom-to-top: volume, RSI, price, MACD.
- Converted the live feed to a module worker.
- Removed the ghost from CandleStick.
- Live feed uses `<symbol>@trade` with bucketed candles.

## Band configuration (current)

const BAND_HEIGHTS = {
   macd: 0.20,
   price: 0.45,
   rsi: 0.15,
   volume: 0.20
};

Bottom to top:
- Volume: 20%  — volume bars, colored by candle direction.
- RSI:    15%  — RSI line + 70/30 level lines.
- Price:  45%  — Bollinger (fill + 3 lines), SMA line,
                 VWMA line, candles.
- MACD:   20%  — histogram + MACD line + signal line.

## Time constants (chart-demo.js)

- `BUCKET_MS = 900000`     — 15-minute candles
- `WINDOW_MS = 86400000`   — 24-hour visible window
- `VISUAL_UPDATE_MS = 1000`— 1 Hz outbound tick
- `PERIOD_MS = 3600000`    — 1-hour rolling window for SMA/VWMA

## Domain strategy

Default is `expanding`. `sliding` is available for fixed-width
contexts (e.g., the original table-cell use case, 180×24px).
`static` freezes the domain.

`expanding` semantics:
- `xDomain = [xMin, xMin + dataRange / (1 - padding)]`
- Data occupies the left `(1 - padding)` of the plot.
- Right `padding` is empty space reserved for the reference
  line label and to avoid the newest point hugging the y-axis.

`sliding` semantics:
- `xDomain = [max(xMin, xMax - windowSize), xMax]`
- Right-anchored, fixed visible window.

## Feed protocol

Both workers accept the same message protocol:

  Main → Worker
    { type: 'config', bucketMs, tickMs, windowMs,
      eventTimeField, indicators, symbol?, stream? }
    { type: 'seed' }         (simulated only)
    { type: 'start' }
    { type: 'stop' }
    { type: 'reset' }
    { type: 'tick' }         (simulated only, manual step)

  Worker → Main
    { type: 'seed',  data: [row, ...] }
    { type: 'tick',  data: row, isNewBucket }
    { type: 'state', running, connected? }
    { type: 'error', message }

Row shape:
- `lastPrice, weightedAvgPrice, prevClosePrice, openPrice,
   highPrice, lowPrice`
- `openTime, closeTime, eventTime`
- `volume`   — Σ(quantity) per bucket
- `notional` — Σ(price × quantity) per bucket
- `bbMean, bbStd, bbUpper, bbLower`  (20-period Bollinger)
- `rsi`                              (14-period Wilder)
- `macd, macdSignal, macdHistogram`  (12 / 26 / 9 EMA)
- `sma`                              (1-hour SMA of close)
- `vwma`                             (1-hour VWMA, typical price)

`eventTime` is the last-trade time within the bucket; `openTime`
is the exact bucket boundary. Rows are keyed on `openTime`. The
`eventTime` field is carried for staleness/debug but is not used
as the x-accessor.

## Indicator factories (classes)

Each indicator class takes `{ plane, yGroup, height, ...options }`
and returns an instance with:
- `layers`        — Layer[] in registration order
- `group`         — y-group id
- `primaryLayer`  — the layer for the y-axis
- `appendPoint(row)`
- `updateLastPoint(row)`
- `appendOrUpdate(row, keyFn)`
- `setData(rows)`
- `remove()`

Application usage:

    const macd = new MACD({
        plane,
        height: BAND_HEIGHTS.macd,
        xAccessor: d => d.openTime,
        trimTail: true
    });

    // on tick:   macd.appendOrUpdate(row, bucketKey);
    // on seed:   macd.setData(rows);
    // on toggle: macd.remove();

## Indicator computers

Each `createXCalc` returns:
- `compute(row)`  — one call per sample, returns derived fields
- `snapshot()`    — opaque state
- `restore(snap)` — rewind to a prior snapshot
- `reset()`       — clear state

The worker holds a `createIndicatorSet(entries, sharedParams)`
that dispatches `compute(row)` to every computer and merges
their outputs into one object. Shared params like `bucketMs` are
merged into each computer's params.

SMA and VWMA read `periodMs` and `bucketMs` to compute a rolling
window of `ceil(periodMs / bucketMs)` buckets.

VWMA accepts `source: 'typical'` (HLC3 × volume, computed from
the row) or `source: 'exact'` (uses `row.notional`).

## Open work

Priority order:

1. `DEFAULT_START_PRICE` in `chart-demo-feed.js` should be
   `5176795.70` (BTCPHP-scale), not `0.0003619`. One-line fix
   so the simulated feed's values match the live feed's scale
   and display cleanly at 2 decimals.
2. `SYMBOL_DECIMALS` constant at the top of `chart-demo.js`.
   Replaces the hardcoded `7`s in layer `decimals:` options and
   `.toFixed(7)` calls. To be sourced from exchange metadata
   when the symbol selector lands.
3. Toolbar dropdown for `maxData` (1d / 7d / 30d / 90d).
   Currently fixed at 7 days.
4. Symbol selector: cycle `demo | live` and a symbol list
   (`BTCPHP`, `USDTPHP`, `ETHPHP`). The live worker already
   reconfigures on `symbol` change; the demo needs the UI.
5. Update HANDOFF.md — the bucketing/candle-interval work is
   complete.

Deferred:
- Indicator registry, composition class, Chart DSL.
- Single shared DataSeries.

## Conventions for future sessions

- One file per message when generating code. Never split a class
  across messages.
- Full-file generation for classes that are changing heavily.
  Patch listings for small edits.
- Keep the JS style: tabs, no semicolon churn, functions declared
  as methods on classes, small helper functions at module scope.
- Every new layer needs: a `.js` file, a `.css` file, a `<link>`
  in `index.html`, and a `CSS.<layer>` block in `CSS.js`.
- Every new indicator needs:
  - `indicators/<Name>.js` — rendering class extending
    `BaseIndicator`.
  - `indicators/<Name>.calc.js` — pure-math computer (unless
    the indicator is just a raw field, like Volume).
  - `indicators.js` — import + `COMPUTERS` entry.
  - Entry in the demo's `INDICATORS` array.
- Indicator classes set descriptive property names for their
  sub-layers (`macd.line`, `bollinger.mean`, `volume.bars`).
  Set one layer as `primary: true` via `addLayer` options.
- Indicator computers have zero imports. Keep them worker-safe.
- The worker's registry (`indicators.js`) must never import an
  indicator class or any DOM-touching module.
- Band vertical order = order of `_yGroupOrder`, which is the
  order the first layer for each group is added. Register groups
  bottom-first to stack them top-down.

## Known refactor candidates (not urgent)

- `ChartLayer` could absorb `update`, `forceUpdate`, `setData`,
  `setWindowSize`, `_applyClips`, `_getEffectiveClip`, and the
  `appendPoint` pipeline (with `_resetCaches` / `_clipKey`
  hooks). Currently duplicated across `Line`, `BarChart`,
  `CandleStick`.
- `_computeCandlePixelWidth` and `_computeBarPixelWidth` share
  ~25 lines. Extract `Utils.sampledIntervalPixelWidth`.
- `_trimTail` is similar across three layers. Extract
  `Utils.findTrimIndex` + `Utils.rangeExtremes`.
- `CartesianPlane` should expose `setBandOrder([...])` so
  vertical stacking is decoupled from layer registration order.
- ReferenceLine's `labelOverflow` could be an option (currently
  the label flip boundary is `plotRight`, and the annotations
  group is not clipped, so labels could extend into the right
  margin).
- Crosshair snap dot doesn't have `vector-effect:
  non-scaling-stroke` while ReferenceLine's pulse does. Cosmetic
  only at extreme scales.
- Pulse animation keyframes are duplicated between
  `ReferenceLine.css` and `CrosshairLayer.css`. Could move to a
  shared `styles/animations.css` if a third user appears.

## How to resume

If you're picking up this project after a break:

1. Read the "Open work" section above.
2. Skim the recent git log for context.
3. Start with the highest-priority open item.

The repo is the source of truth for what the code *is*. This
file records the decisions behind it.