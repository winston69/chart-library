# Development Roadmap

This roadmap addresses the main design risks while preserving the current
direction: a browser-native, multi-band chart library with primitive layers,
composed indicators, and worker-side market-data calculations. The phases are
prioritized and intentionally incremental; each should leave the project usable.

## Phase 1: Safety Rails (Immediate)

Introduce a lightweight test harness for the pure-math indicator computers.
Keep the initial scope limited to `indicators/*.calc.js` and the worker-side
registry so tests run in Node without a DOM or third-party dependencies.

1. Add a `test` script to `package.json` using Node's built-in test runner,
   such as `node --test`. Document the minimum supported Node version required
   by that runner.
2. Add focused tests for each calculator's documented outputs and a small set
   of representative input sequences. Prefer explicit expected values and
   simple invariants over tests coupled to private implementation details.
3. Test the state contract: `snapshot()` followed by `restore()` reproduces
   the same next result; `reset()` returns a calculator to its initial state.
   Include a forming-bucket scenario to protect the deterministic rewind and
   recompute behavior used by the workers.
4. Test `createIndicatorSet` for configured calculator dispatch, merged output,
   snapshot/restore, reset, and its documented invalid-entry and unknown-name
   errors.
5. Keep calculations pure and independent from rendering. Do not introduce a
   DOM shim or a test framework unless later test requirements demonstrate a
   need for one.

**Exit criteria:** `npm test` runs from a clean checkout with no added runtime
dependencies, covers every existing calculator and the registry contract, and
fails when a representative output or state-rewind behavior regresses.

## Phase 2: API Fortification

Make the package entry point the explicit, documented boundary between
supported public API and internal implementation details.

1. Inventory the exports in `index.js`, compare them with actual module
   exports, and identify which symbols are supported for consumers. In
   particular, reconcile its current `createMACD`, `createBollinger`, and
   `createRSI` re-exports with the corresponding rendering modules, which
   currently export `MACD`, `Bollinger`, and `RSI` classes.
2. Choose and consistently expose the intended indicator API. Update the
   barrel, README examples, and indicator documentation together. Explicitly
   decide whether calculator factories and worker registry helpers are public
   exports or worker-only implementation details.
3. Document the layer contract: lifecycle and removal behavior, slot and
   y-group assignment, domain contribution, CSS class registration, default
   styles, and required `index.html` stylesheet inclusion for demo layers.
4. Document the indicator contract: `BaseIndicator` composition and primary
   layer selection; the uniform data methods; pure `*.calc.js` requirements;
   `compute`/`snapshot`/`restore`/`reset`; and registration in `indicators.js`
   and the demo where applicable. Include a short, ordered checklist for
   adding one layer and one computed indicator.
5. Add a no-dependency smoke test that imports the public entry point in Node
   and verifies the documented public symbols are available. Keep browser-only
   behavior out of this test or test it separately in a browser.
6. Treat the public API as stable only after the export and documentation
   audit is complete. Until then, clearly label additions and breaking
   changes as pre-release.

**Exit criteria:** every documented public export resolves from `index.js`,
the public examples match the exported API, and contributor checklists capture
the conventions needed to add layers and indicators without relying on
undocumented knowledge.

## Phase 3: Architectural Weight

**Status: Complete (2026-10-26).** Layout math now lives in the DOM-free
`core/ChartLayout.js` module, is covered by Node unit tests, and is consumed by
`CartesianPlane.js`; the plane retains DOM updates, layer lifecycle, events,
and domain computation.

Reduce the central responsibility of `CartesianPlane.js` without weakening
its role as the chart coordinator. Make the split in tested, behavior-preserving
steps rather than moving DOM and state wholesale.

1. First add characterization coverage for the plane's observable layout
   behavior: margins, band sizes/order, y-group ranges, and domain union. Keep
   DOM-dependent integration cases in a browser-capable test environment only
   if they cannot be isolated as pure calculations.
2. Extract deterministic layout calculations into a small DOM-free module.
   Give it explicit inputs (dimensions, margins, band configuration, and
   requests) and outputs (computed plot bounds and band geometry); avoid
   letting it reach into plane state or mutate DOM.
3. Have `CartesianPlane` call the new layout module and remain responsible for
   coordinating layer lifecycle, DOM updates, render scheduling, and events.
   Keep the public plane API and render order unchanged during the extraction.
4. After the layout boundary proves useful, consider separately extracting
   band/y-group bookkeeping or render-order computation. Extract only cohesive
   responsibilities with stable inputs and outputs; do not split methods into
   modules merely to reduce file length.
5. Retain integration tests for plane-to-layer behavior and use the layout
   unit tests to cover edge cases that do not need a browser.

**Exit criteria:** Complete. Layout calculations are independently testable,
existing plane behavior is preserved, and the plane's remaining
responsibilities have clear boundaries rather than merely being relocated.

## Phase 4: Deployment (Cloudflare Worker)

Deploy the demo as a public site while keeping exchange REST requests behind a
narrow Cloudflare Worker proxy. The static site and API proxy are separate
deployments; `server.js` remains the zero-dependency local development fallback.

1. Implement Worker routes for `/api/trades`, `/api/klines`, and
   `/api/symbol-info`. Map each route to a fixed Coins.ph upstream endpoint,
   forward the query string, support `GET` and CORS preflight `OPTIONS`, and
   return upstream statuses and explicit proxy errors. Do not accept arbitrary
   upstream URLs.
2. Configure CORS for the deployed demo origin, including `OPTIONS` responses
   and `Vary: Origin`. Keep allowed origins configurable so the Pages origin
   can be set at deployment time; do not enable credentials unless needed.
3. Configure the demo to pass one API base URL to both live-feed workers. Use
   the local Wrangler origin for localhost development and the deployed Worker
   URL for the public site. Keep the synthetic demo feed independent of the API.
4. Run `npm run dev` and `npm run demo` with Wrangler so local development
   exercises the same Worker proxy used by the deployed demo. Keep
   `server.js` as a fallback. Live exchange feeds require network access;
   offline development remains available through the demo source.
5. Document Worker configuration and deployment, then verify all three API
   routes, CORS preflight, both live-feed seed paths, deployed-origin behavior,
   and local development before publishing.

**Exit criteria:** the public demo loads from its deployed static host, both
live sources can fetch seed data through the Worker, Worker CORS permits the
deployed origin, and `npm run dev` continues to work locally without requiring
Cloudflare credentials.

## Future Considerations: Generalization

Do not pivot to a generic chart library by default. The current design's
multi-band model, bucket updates, and indicator worker pipeline are valuable
for trading charts and are already the project's strongest domain-specific
capabilities.

Use actual consumer needs to decide whether to generalize: identify repeated
use cases outside market data, determine which abstractions remain useful
without trading assumptions, and compare the maintenance cost against the
value of serving those users. If those needs are not evidenced, double down on
the trading domain, document that scope, and generalize only stable primitives
that have a concrete second use case.

**Decision gate:** make the pivot decision from demonstrated user requirements
and API pressure, not from a desire for generic abstractions alone.
