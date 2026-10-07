# SESSION

Project: multi-band chart library + demo.
Last update:  07/10/2026 19:59:45.71.

## Purpose of this file

If a working session is interrupted, this file is the source of
truth for architectural decisions and open work. Paste it into a
new session along with the repo URL to resume.

The repo itself is the source of truth for what the code *is*.
This file explains what the code *means* and where it's going.

---

## State

- Four bands, top to bottom: MACD, price + Bollinger + WAP, volume.
  (STD pane was removed; its math lives only in the feed.)
- All layers are primitive: one class, one visual concept.
- The plane handles slots, y-groups, layout, margins, and domain
  union. It knows nothing about specific indicators.

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

- Split `LineChart` into `Line`, `Area`, `Points`.
- Extracted `GhostLine` and `BandFill` as standalone layers.
- Removed `Pointer.js`; `SVG.getPoint` and `SVG.pointInBounds` now
  live on the `SVG` object.
- Removed `Axis.js` compat shim; `AxisLayer` renamed to `Axis`.
- Removed `CartesianPlane._getSvgPoint`; consumers call
  `SVG.getPoint` directly.
- `CSS.js` trimmed to class maps + `get`/`getNumber`. Every color
  helper, theme helper, and observer was unused and removed.
- `Utils.js` trimmed to functions with active callers:
  `clamp`, `uniqueId`, `findNearestByX`, `findExtremes`,
  `downsample`, `limitPoints`. Dead helpers removed.

## Band configuration (current)

- MACD: 25%      — histogram + MACD line + signal line
- Price: 55%     — Bollinger (fill + 3 lines), WAP (area + line),
                   candles, price ghost, WAP ghost
- Volume: 20%    — signed bars, up/down colored

Band heights are declared in `BAND_HEIGHTS` at the top of
`chart-demo.js`.

## Feed (`chart-demo-feed.js`)

Worker computes derived fields and emits one row per tick.

Row shape:
- `lastPrice, weightedAvgPrice, prevClosePrice, openPrice,
   highPrice, lowPrice`
- `openTime, closeTime, eventTime`
- `bbMean, bbStd, bbUpper, bbLower`     (20-period Bollinger)
- `volume`                              (correlated with move)
- `macd, macdSignal, macdHistogram`     (12 / 26 / 9 EMA)

Indicators are computed in the worker. Layers render, they don't
compute. This matches the codebase convention.

## Open work

Priority order:

1. Extract MACD construction into a factory (`indicators/MACD.js`).
2. Extract Bollinger construction into a factory
   (`indicators/Bollinger.js`).
3. Rewrite the affected sections of `chart-demo.js` to use the
   factories. Target: ~80 lines removed from the demo.
4. (Deferred) Indicator registry (`indicators/registry.js`) — a
   type-name → factory map. Build when a dropdown is added.
5. (Deferred) Composition class — a `Layer` facade over a factory
   for indicators that need to be addressed as units.
6. (Deferred) Chart DSL — declarative config that maps to registry
   calls. Build when a serializable config or plugin system is
   needed.

Steps 4–6 are additive. Each is optional. None requires changing
the levels below it.

## Factory shape (agreed)

A factory takes a plane and returns a uniform handle:

    {
      layers: Layer[],
      group: string,
      appendPoint(row),
      setData(rows),
      remove()
    }

Optional: `axis`, `onCrosshair`. The factory does not wrap the
plane, does not manage layout, does not own the axis by default.

Application usage:

    const macd = createMACD({ plane, yGroup: 'macd-group', height: 0.25 });
    // on tick:        macd.appendPoint(row);
    // on seed:        macd.setData(rows);
    // on toggle off:  macd.remove();

## Known refactor candidates (not urgent)

- `ChartLayer` could absorb `update`, `forceUpdate`, `setData`,
  `setWindowSize`, `_applyClips`, `_getEffectiveClip`, and the
  `appendPoint` pipeline (with `_resetCaches` / `_clipKey` hooks).
  Currently duplicated across `Line`, `BarChart`, `CandleStick`.
- `_computeCandlePixelWidth` and `_computeBarPixelWidth` share
  ~25 lines. Extract `Utils.sampledIntervalPixelWidth`.
- `_trimTail` is similar across three layers. Extract
  `Utils.findTrimIndex` + `Utils.rangeExtremes`.

Do not do these until the indicator factories land. They shrink the
codebase but they don't change what the app does, and the factories
are the higher-value change.

## Conventions for future sessions

- One file per message when generating code. Never split a class
  across messages.
- Full-file generation for classes that are changing heavily.
  Patch listings for small edits.
- Keep the JS style: tabs, no semicolon churn, functions declared
  as methods on classes, small helper functions at module scope.
- Every new layer needs: a `.js` file, a `.css` file, a `<link>`
  in `index.html`, and a `CSS.<layer>` block in `CSS.js`.

## How to resume

If you're picking up this project after a break:

1. Read the "Open work" section above.
2. Skim the recent git log for context.
3. Start with the highest-priority open item.

The repo is the source of truth for what the code *is*. This
file records the decisions behind it.