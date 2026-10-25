# Contributing

## Adding a New Indicator

Use these steps to keep worker calculations separate from main-thread
rendering:

1. **Add the rendering class** in `indicators/<Name>.js`. Extend
   `BaseIndicator`, compose existing primitive layers, and choose a primary
   layer with `addLayer(..., { primary: true })`. Finish construction with
   `build()` and preserve the shared data methods: `appendPoint`,
   `updateLastPoint`, `appendOrUpdate`, `setData`, and `remove`.
2. **Add the calculator** in `indicators/<Name>.calc.js` when the indicator
   computes derived values. Keep it pure math with no imports or DOM
   dependencies; return a computer implementing `compute(row)`,
   `snapshot()`, `restore(snapshot)`, and `reset()`. A raw field already
   maintained by the feed, such as volume, does not need a calculator.
3. **Register the calculator** in the worker-side `indicators.js`: import
   the factory and add it to `COMPUTERS`. Do not import rendering classes or
   other DOM-dependent modules into this registry.
4. **Register the calculation in the demo workers** by adding its name or
   parameterized entry to `DEFAULT_INDICATORS` in both
   `chart-demo-feed.js` and `chart-demo-live.js`, as applicable. Keep the
   demo's matching rendering-class instance in `chart-demo.js` in sync with
   the row fields produced by the calculator.
5. **Add required styles.** Prefer existing primitive styles. If the
   indicator requires a new layer or visual styling, add its CSS class
   constants in `core/CSS.js`, provide defaults in the appropriate
   `styles/<Layer>.css`, and link the stylesheet from `index.html`. Add any
   styles intended for the library's bundled stylesheet to `index.css`.
6. **Expose the rendering class** from the root `index.js` barrel if it is
   part of the consumer-facing API. Keep calculator factories and worker
   registry helpers worker-only.
7. **Verify the change** with `npm test` and the demo (`npm run dev`).

See [SESSION.md](./SESSION.md) for the full indicator and layer conventions.
