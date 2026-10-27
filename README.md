[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/winston69/chart-library/blob/main/LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/winston69/chart-library)](https://github.com/winston69/chart-library/commits/main)
# chart-library

A primitive-layer chart library. Layers render one visual thing each.
The plane handles slots, layout, bands, and domain union. Indicators
are composed by the application, not baked into classes.

## Status

Early. API is not stable. No npm release yet.

## What it looks like

![Demo](https://winston69.github.io/chart-library/chart-demo.png)
[Live demo](https://winston69.github.io/chart-library/)

## Quick start

    git clone https://github.com/winston69/chart-library.git
    cd chart-library
    npm run dev
    # open http://localhost:8787

Local development requires Node.js 22 or newer for Wrangler.

## Concepts

- **Layer** — one visual primitive. Line, BarChart, CandleStick,
  GhostLine, BandFill, etc. Each renders one thing.
- **Plane** — the CartesianPlane. Owns DOM, slots, y-groups,
  layout, margins, and the union of layer domains.
- **Band** — a horizontal strip of the plot with its own y-scale.
  Layers belong to a band.
- **Slot** — where in the plane's DOM tree a layer renders.
- **Indicator** — a rendering class composed from layers. The
  worker calculates derived values separately; the main thread
  supplies rows to the indicator.

## Public API

Import rendering classes and primitives from `index.js`. For example:

```js
import { CartesianPlane, MACD, RSI, Bollinger } from './index.js';
```

`BaseIndicator`, `MACD`, `Bollinger`, `RSI`, `SMA`, `VWMA`, and
`Volume` are the public indicator classes. Calculator factories in
`indicators/*.calc.js` and `createIndicatorSet` in `indicators.js`
are worker-side implementation details, not root-barrel exports. The
demo keeps that separation: it creates rendering classes on the main
thread, while its feed workers use the calculator registry.

## Layers

| Layer                | Contributes to domain | Notes                          |
|----------------------|-----------------------|--------------------------------|
| Line                 | yes                   |                                |
| Area                 | no                    | fill under a Line              |
| Points               | no                    | circles at each sample         |
| GhostLine            | no                    | dashed unclipped polyline      |
| BandFill             | no                    | fill between two layers        |
| BarChart             | yes                   | up/down coloring               |
| CandleStick          | yes                   | wicks and bodies               |
| ReferenceLine        | no                    | horizontal/vertical annotation |
| Axis / XAxis / YAxis | margin                |                                |
| CrosshairLayer       | no                    |                                |
| InteractionLayer     | no                    | pan, zoom, axis drag           |

## CSS conventions

- JS writes geometry, behavior, content.
- CSS writes appearance: colors, strokes, dashes, radii, fonts.
- Numeric CSS variables that feed JS are read once in the
  constructor via `CSS.getNumber('--variable')`.
- Every layer's CSS file declares its defaults at `:root`.
- Class names live in `core/CSS.js`.

## Demo

The demo is `index.html` plus `chart-demo-feed.js`. It runs a web
worker that simulates a market data feed. No build step.

    npm run dev

Local development uses Wrangler to serve the demo and API Worker at
`http://localhost:8787`. `server.js` remains available as a fallback.

See [SESSION.md](./SESSION.md) for architectural decisions and open work.
See [CONTRIBUTING.md](./CONTRIBUTING.md) for the indicator checklist.

## License

MIT