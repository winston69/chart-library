# SESSION

Project: multi-band chart library + demo.
Last update: 2026-10-25.

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
- The live worker buffers raw trades and rebuckets on demand.
  Timeframe changes do not clear the chart; they swap seeds.

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
UI layers: `Button`, `Dropdown`, `ToolBar`, `ToolTip`.

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
10. Axis grid labels derive their decimal precision from the
    major step: `decimals = max(declared, stepDerived)`. Declared
    is a floor. Step-derived is `max(0, -floor(log10(majorStep)))`.
    Crosshair / snap labels use `_getEffectiveDecimals()` (the
    declared value, raised if the domain is small enough).
11. Axis minor and micro tiers are dropped when their on-screen
    spacing falls below the configured thresholds
    (`minMinorSpacing`, default 8px; `minMicroSpacing`, default
    4px). This keeps dense tiers off short bands.
12. Source selection and feed emission are separate concerns.
    `currentSource` picks which worker is active; `feedRunning`
    mirrors the active worker's emission state. The source
    dropdown selects; the feed button starts/pauses.
13. Live data fetching is split: a local Node proxy (`server.js`)
    fetches the REST seed and serves it with CORS headers; the
    worker connects to the WebSocket for live updates. Do not
    fetch the exchange REST API directly from the browser.

## Recent cleanups

### Session 2026-10-26

Architectural weight — layout boundary
- Extracted pure margin aggregation, plot-bound calculations, and
  proportional y-group band geometry into `core/ChartLayout.js`.
- `CartesianPlane.js` delegates geometry to the module and retains
  DOM updates, layer lifecycle, render scheduling, and events.
- Added `tests/layout.test.js` for margin subtraction, zero-height
  plots, and band ratios/order.
- Phase 3 is complete. Domain computation and plane coordination
  remain in `CartesianPlane.js`.

### Session 2026-10-25

Live feed & local proxy
- Added `server.js` (zero-dependency Node `http`/`https` server)
  to serve static files and proxy `/api/trades` to
  `api.pro.coins.ph`, injecting CORS headers.
- `package.json` `dev`/`demo` scripts switched from `npx serve`
  to `node server.js`.
- Live worker fetches 1000 historical trades via the local
  proxy on `start()`, using `symbol` from the current config.
- Removed `SortedQueue.js`. The live worker now processes the
  REST seed synchronously inside `fetchHistoricalSeed()` using
  an `isSeeding` flag to suppress outbound ticks, then emits
  one `seed` message with all rebucketed rows.
- `handleConfig` still rebuckets from `tradeBuffer` on
  timeframe changes without re-fetching.

### Session 2026-10-24

Toolbar and controls
- Introduced `Dropdown` (`ui/Dropdown.js`) — trigger built
  internally (label + caret), popup with item list, keyboard
  navigation, click-away close, flip-up placement when space
  below is tight.
- Added `caretDown` / `caretUp` to `Icons.js`.
- Introduced `ToolBar` groups: `addGroup({ id, label,
  showLabel })`. `tool` group created implicitly. Groups render
  as clusters with an optional label and a divider between
  clusters.
- Added `ToolBar.showGroupLabels` toggle, per-group override.
- `CSS.toolbar` gained `groupCluster`, `groupLabel`,
  `groupItems`.
- Toolbar layout: Tools, View, Data, Demo clusters.
- `Dropdown.setTooltip` added.

Feed model
- Split source selection from feed emission. `sourceButton` →
  `sourceDropdown` (Demo / Live options). Feed control is a
  separate button.
- Single `feedRunning` + `currentSource`; the source dropdown
  stops the running worker before switching.
- Demo worker is persistent (seeded on page load).
- Live worker is lazy (created on first start).
- `resetData` clears the chart and sends `reset` to the
  active worker. Demo reseeds from scratch; live disconnects,
  clears its buffer, and reconnects with an empty seed.
- No synthetic live seed. The `seed` mechanism is preserved;
  live posts `{ type: 'seed', data: [] }` on start and after
  reset.

Live worker buffer
- Added `tradeBuffer` (chronological `{ price, qty, time }`).
  Bounded by `maxData` in time and `MAX_TRADES` in count.
- `stop` now pauses emission but keeps the WebSocket open and
  the buffer growing.
- New `disconnect` message: stops emission, closes the
  WebSocket, clears the buffer.
- `config` detects field changes. Symbol/stream change →
  disconnect + clear + reconnect + empty seed. Timeframe
  change → rebucket from buffer + fresh seed. No reconnect.
- `reset` = disconnect + clear + reconnect (if was emitting) +
  empty seed.
- `start` emits the current buffer as a seed before beginning
  to tick. Catches up after a pause.
- Removed `buildSeed` (the synthetic random walk).
- Removed the per-bucket `data` array (`finalizeBucket` now
  just clears `currentBucket`).

Axis
- Step-derived decimal precision. Grid labels use
  `decimals = max(declared, stepDerived)`.
- `minorStep = majorStep / 2`, `microStep = majorStep / 10`
  (was `/5` and null for the nice path).
- Pixel-spacing guard: minor/micro tiers dropped below
  `minMinorSpacing` / `minMicroSpacing`.
- `DEFAULT_NUMERIC_TICK_COUNT` dropped from 12 to 4 (soft
  target; snapped step often yields more).
- `decimalsForStep()` helper at module scope.

Crosshair / reference line
- Crosshair snap dot is a `<g>` containing a core dot plus
  three animated rings, matching the ReferenceLine pulse.
- Shared amber fill (`#fbbf24`), shared dark rim
  (`rgba(15, 15, 15, 0.6)`), shared keyframes (seamless loop).
- ReferenceLine label measures text with
  `getComputedTextLength()`; falls back to an estimate on the
  first frame.

Layer behavior
- Layers trim at `this._windowSize` (set by the plane to
  `maxData`), not `plane.windowSize`.
- `CartesianPlane` gained `maxData` and `padding`.
- `domainStrategy` default is `expanding`.
- Axes render into margin slots (`Axis.slot = 'margin'`).

### Earlier

- Introduced `BaseIndicator`. Converted MACD/RSI/Bollinger to
  classes. Added SMA/VWMA/Volume.
- Split computers into per-indicator `*.calc.js` files.
  `indicators.js` is now a thin registry.
- `compute(row)` contract; `createIndicatorSet` accepts
  params + sharedParams.
- Initial session 2026-10-16 changes listed in the prior
  SESSION.md revision (available in git history).

## Band configuration (current)

const BAND_HEIGHTS = {
   macd: 0.20,
   price: 0.50,
   rsi: 0.15,
   volume: 0.15
};

Bottom to top:
- Volume: 15%  — volume bars, colored by candle direction.
- RSI:    15%  — RSI line + 70/30 level lines.
- Price:  50%  — Bollinger (fill + 3 lines), SMA line,
                 VWMA line, candles.
- MACD:   20%  — histogram + MACD line + signal line.

## Time constants (chart-demo.js)

- `TARGET_CANDLES = 96` — target visible candle count
- `TIMEFRAMES` — 1m / 5m / 15m / 1h / 4h / 1d; each entry
  carries `value` (bucketMs) and `windowMs`
- `VISUAL_UPDATE_MS = 1000` — 1 Hz outbound tick
- `MAX_DATA_OPTIONS` — 1d / 7d / 30d / 90d
- `currentPeriodMs() = 4 * bucketMs` — SMA/VWMA lookback

## Domain strategy

Default is `expanding`. `sliding` is available for fixed-width
contexts. `static` freezes the domain.

`expanding` semantics:
- `xDomain = [xMin, xMin + dataRange / (1 - padding)]`
- Data occupies the left `(1 - padding)` of the plot.
- Right `padding` is empty space reserved for the reference
  line label.

`sliding` semantics:
- `xDomain = [max(xMin, xMax - windowSize), xMax]`
- Right-anchored, fixed visible window.

## Feed protocol

Both workers accept the same message protocol:

  Main → Worker
    { type: 'config', bucketMs, tickMs, windowMs, maxData?,
      eventTimeField, indicators, symbol?, stream? }
    { type: 'seed' }          (simulated only)
    { type: 'start' }
    { type: 'stop' }
    { type: 'disconnect' }    (live only)
    { type: 'reset' }
    { type: 'state' }         (query)
    { type: 'tick' }          (simulated only, manual step)

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
- `sma`                              (4-bucket SMA of close)
- `vwma`                             (4-bucket VWMA, typical price)

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

1. Cloudflare Worker for historical seed. When available, both
   workers' `seed` mechanism carries real rows. The live worker
   currently fetches 1000 trades via the local proxy; this
   should eventually be replaced by a Cloudflare-fetched
   historical kline payload for deeper history.
2. `SYMBOL_DECIMALS` sourced from exchange metadata. Currently a
   constant at the top of `chart-demo.js` (value `2`).
3. `DEFAULT_START_PRICE` in `chart-demo-feed.js` should match
   live BTCPHP scale. Check whether the demo feed still starts
   at a tiny value and bump it if so.
4. Button-level `showLabels` toggle for the ToolBar (independent
   of `showGroupLabels`). Deferred until the settings panel exists.

Deferred:
- Indicator registry, composition class, Chart DSL.
- Single shared DataSeries.
- Group label `left` position variant (currently `top` only).
- Status-bar content in the toolbar (via `group.setLabel` or a
  future `group.setContent`).

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
- Feed workers must not depend on the layer classes. They post
  rows; the main thread renders.
- Source selection and feed emission are separate. New sources
  plug in via `currentSource` and a feed worker that speaks the
  same protocol; the source dropdown cycles them, the feed button
  controls the active one.
- Timeframe changes rebucket from the live worker's buffer.
  Do not clear the chart on timeframe change.
- Live data: use the local proxy (`/api/trades`) for REST seed
  fetches. Do not hit the exchange API directly from the browser.

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
- `updateLastPoint` shares the rescan-on-extreme logic across
  three layers. Same hoist target as above.
- `CartesianPlane` should expose `setBandOrder([...])` so
  vertical stacking is decoupled from layer registration order.
- `ReferenceLine` label flip boundary is `plotRight`. Could
  gain a `labelOverflow` option so labels can extend into the
  right margin.
- Crosshair snap dot doesn't have `vector-effect:
  non-scaling-stroke` while ReferenceLine's pulse does.
  Cosmetic only at extreme scales.
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