# Copilot Instructions

## Build, test, and lint

- `npm run dev` serves the repository at `http://localhost:8000`; open `index.html` for the demo.
- `npm run demo` is an alias for the same static server.
- There is no build, test, or lint script, and no test suite is currently configured. No single-test command is available.

## Architecture

- This is a browser-native ES-module library with no compile/build step. `index.js` is the public API barrel; `index.html` and `chart-demo.js` wire the interactive demo.
- `core/CartesianPlane.js` owns the chart DOM, layer lifecycle and render loop, layout, bands/y-groups, margins, and combined layer domains. It does not own individual layer rendering or selection/interaction behavior.
- Layers are single-purpose visual primitives. `core/Layer.js` defines the base lifecycle; data-contributing primitives extend `core/ChartLayer.js`. Axes, interactions, cards, and UI are separate components composed around the plane.
- Indicator classes extend `indicators/BaseIndicator.js` and compose/register primitive layers with the plane. The corresponding `*.calc.js` modules provide pure calculations for workers. `indicators.js` is the worker-side registry: keep its import graph free of DOM-dependent rendering modules, and register new calculation factories there.
- The demo keeps calculation and rendering separate: feed workers produce rows and derived indicator values; the main thread updates chart layers and indicators.

## Repository conventions

- Keep each layer focused on one visual concept; compose multi-part indicators from layers rather than adding indicator-specific behavior to the plane or a primitive.
- Keep indicator rendering classes and worker calculations separate. Calculation factories expose `compute(row)`, `snapshot()`, `restore(snapshot)`, and `reset()`; snapshots support deterministic recomputation of a forming bucket.
- For live bucketed rows, use the shared `appendOrUpdate(row, keyFn)` contract: same key replaces the tail row, a new key appends a row.
- JavaScript owns geometry, behavior, and content; CSS owns visual appearance. Put layer class-name constants in `core/CSS.js`, and layer styling/default variables in the corresponding `styles/*.css` file. Read numeric CSS variables used by JavaScript through `CSS.getNumber()` during construction.
- Export additions intended for library consumers from `index.js`.

See [README.md](../README.md) for the library concepts and demo, and [SESSION.md](../SESSION.md) for detailed architectural decisions and current project state.

## Project Context

Always read `SESSION.md` and `HANDOFF.md` at the start of a complex task to understand the current development direction and recent architectural decisions.
