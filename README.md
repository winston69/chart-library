[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/winston69/chart-library/blob/main/LICENSE)
# chart-library

A primitive-layer chart library. Layers render one visual thing each.
The plane handles slots, layout, bands, and domain union. Indicators
are composed by the application, not baked into classes.

## Status

Early. API is not stable. No npm release yet.

## What it looks like

[one screenshot or a link to the demo]

## Quick start

    git clone https://github.com/winston69/chart-library.git
    cd chart-library
    npm run dev
    # open http://localhost:8000

## Concepts

- **Layer** — one visual primitive. Line, BarChart, CandleStick,
  GhostLine, BandFill, etc. Each renders one thing.
- **Plane** — the CartesianPlane. Owns DOM, slots, y-groups,
  layout, margins, and the union of layer domains.
- **Band** — a horizontal strip of the plot with its own y-scale.
  Layers belong to a band.
- **Slot** — where in the plane's DOM tree a layer renders.
- **Indicator** — a composition of layers that reads data and
  renders multiple visuals. Composed in the application, not
  as a class.

## Layers

| Layer                | Contributes | Notes                          |
|                      | to domain   |                                |
|----------------------|-------------|--------------------------------|
| Line                 | yes         |                                |
| Area                 | no          | fill under a Line              |
| Points               | no          | circles at each sample         |
| GhostLine            | no          | dashed unclipped polyline      |
| BandFill             | no          | fill between two layers        |
| BarChart             | yes         | up/down coloring               |
| CandleStick          | yes         | wicks and bodies               |
| ReferenceLine        | no          | horizontal/vertical annotation |
| Axis / XAxis / YAxis | margin      |                                |
| CrosshairLayer       | no          |                                |
| InteractionLayer     | no          | pan, zoom, axis drag           |

## CSS conventions

- JS writes geometry, behavior, content.
- CSS writes appearance: colors, strokes, dashes, radii, fonts.
- Numeric CSS variables that feed JS are read once in the
  constructor via `CSS.getNumber('--variable')`.
- Every layer's CSS file declares its defaults at `:root`.
- Class names live in `styles/CSS.js`.

## Demo

The demo is `index.html` plus `chart-demo-feed.js`. It runs a web
worker that simulates a market data feed. No build step.

    npm run dev

## Roadmap

- Indicator factories: `createMACD`, `createBollinger`, etc.
- Indicator registry: type name → factory.
- Optional Chart DSL for declarative configuration.

See `SESSION.md` for current state and decisions.

## License

MIT