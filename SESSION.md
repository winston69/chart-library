# SESSION

Project: multi-band chart library + demo.
Last update: <fill in the current date and time>.

## Purpose of this file

If a working session is interrupted, this file is the source of
truth for architectural decisions and open work. Paste it into a
new session along with the repo URL to resume.

The repo itself is the source of truth for what the code *is*.
This file explains what the code *means* and where it's going.

---

## State

- Four bands, bottom to top: volume, RSI, price + Bollinger + WAP,
  MACD. Top to bottom: MACD, price, RSI, volume.
- All layers are primitive: one class, one visual concept.
- The plane handles slots, y-groups, layout, margins, and domain
  union. It knows nothing about specific indicators.
- Indicators are composed in the application (or in indicator
  factories), not baked into layer classes.

## Layer inventory

Primitives:
- `Line`         — polyline through data. Contributes to domain.
- `Area`         — fill under a Line down to a baseline. No domain.
- `Points`       — circles at each sample. No domain.
- `GhostLine`    — dashed unclipped polyline. No domain.
- `BandFill`     — fill between two source layers. No domain.
- `BarChart`     — bars, up/down coloring, baseline-configurable.
- `CandleStick`  — wicks + bodies.
- `ReferenceLine`— horizontal/vertical annotation with optional pulse.
- `Axis` / `XAxis` / `YAxis` — ticks, labels, grid.
- `CrosshairLayer`, `InteractionLayer` — pointer behaviors.

Card layers (HTML overlay): `CardStrip`, `Legend`, `OHLCCard`, `InfoCard`.
UI layers: `Button`, `ToolBar`, `ToolTip`.

Indicator factories:
- `createMACD`       — histogram + MACD line + signal line.
- `createBollinger`  — fill + lower/upper/mean lines.
- `createRSI`        — RSI line + 70/30 level lines.

## Architectural rules

1. One layer, one visual primitive. Composition happens in the
   application, not in a class.
2. JS writes geometry, behavior, and content. CSS writes appearance
   (color, stroke, width, dash, opacity, font-size, radius).
3. Numeric CSS variables that feed JS math are read once in the
   constructor via `CSS.getNumber('--variable')`. No caches, no
   fallbacks. A missing variable throws with the variable name.
4. Every layer's CSS file declares its numeric defaults in a
   `:root` block so they're readable before any group exists.
5. Class names live in `CSS.js`. Layers import `CSS.<layer>` and
   use the strings; nothing else knows the raw class names.

## Recent cleanups

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
- Added indicator factories: `createMACD`, `createBollinger`,
  `createRSI`.
- Extracted indicator computation from `chart-demo-feed.js` into
  `demo/indicators.js` (`createIndicatorSet`).
- Rewrote `chart-demo.js` to use the factories.
- Band stack bottom-to-top: volume, RSI, price, MACD.

## Band configuration (current)

const BAND_HEIGHTS = {
   macd: 0.20,
   price: 0.45,
   rsi: 0.15,
   volume: 0.20
};

Bottom to top:
- Volume: 20%  — signed bars, up/down colored.
- RSI:    15%  — RSI line + 70/30 level lines.
- Price:  45%  — Bollinger (fill + 3 lines), WAP (area + line),
                 candles, price ghost, WAP ghost.
- MACD:   20%  — histogram + MACD line + signal line.

Band heights are declared in `BAND_HEIGHTS` at the top of
`chart-demo.js`.

## Feed (`chart-demo-feed.js`)

Worker generates raw fields and delegates derived fields to
`demo/indicators.js` (`createIndicatorSet`). One row per tick.

Row shape:
- `lastPrice, weightedAvgPrice, prevClosePrice, openPrice,
   highPrice, lowPrice`
- `openTime, closeTime, eventTime`
- `volume`                              (correlated with move)
- `bbMean, bbStd, bbUpper, bbLower`     (20-period Bollinger)
- `rsi`                                 (14-period Wilder)
- `macd, macdSignal, macdHistogram`     (12 / 26 / 9 EMA)

Indicators are computed in the worker. Layers render, they don't
compute.

## Indicator factories

Each factory takes a plane and returns a uniform handle:

    {
      layers: Layer[],
      group: string,
      primaryLayer: Layer,
      appendPoint(row),
      setData(rows),
      remove()
    }

Optional: `axis`, `onCrosshair`. The factory does not wrap the
plane, does not manage layout, does not own the axis by default.

Application usage:

    const macd = createMACD({
        plane,
        yGroup: 'macd-group',
        height: BAND_HEIGHTS.macd
    });

    // on tick:        macd.appendPoint(row);
    // on seed:        macd.setData(rows);
    // on toggle off:  macd.remove();

## Open work

Priority order:

1. (Deferred) Indicator registry (`indicators/registry.js`) — type
   name → factory. Build when a dropdown UI is added.
2. (Deferred) Composition class over factories.
3. (Deferred) Chart DSL — declarative config mapping to registry
   calls.
4. (Deferred) Single shared DataSeries. One canonical row store;
   all layers reference it. Removes per-layer data duplication.
   Requires changing `ChartLayer.appendPoint` and `setData`
   semantics. Large refactor; no immediate benefit.
5. (Deferred) `Line` gaining a `constantY` option so level lines
   (RSI 70/30) don't hold per-row data.

## Conventions for future sessions

- One file per message when generating code. Never split a class
  across messages.
- Full-file generation for classes that are changing heavily.
  Patch listings for small edits.
- Keep the JS style: tabs, no semicolon churn, functions declared
  as methods on classes, small helper functions at module scope.
- Every new layer needs: a `.js` file, a `.css` file, a `<link>`
  in `index.html`, and a `CSS.<layer>` block in `CSS.js`.
- Indicator factories must guard delegated calls:
  `typeof layer.appendPoint === 'function'` before calling.
  Not every layer owns data — `BandFill`, `Area`, `Points`,
  `GhostLine` read from a `sourceLayer`.
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

None of these are urgent.

## How to resume

If you're picking up this project after a break:

1. Read the "Open work" section above.
2. Skim the recent git log for context.
3. Start with the highest-priority open item.

The repo is the source of truth for what the code *is*. This
file records the decisions behind it.