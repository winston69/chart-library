// ──────────────────────────────────────────────────────────────
// indicators/Bollinger.calc.js
//
// Bollinger Bands computer. Pure math. Worker-safe — no DOM,
// no imports.
//
// Maintains a rolling window of the last `period` prices.
// Advances once per compute(row) call, reading row.lastPrice
// as the sample price. On every call it pushes the new price,
// evicts the oldest if the window is full, and returns mean,
// standard deviation, and the upper/lower bands
// (mean ± multiplier·σ).
//
// Population standard deviation (divide by n), matching the
// standard Bollinger formula. Sample stdev (divide by n-1) is
// common in other contexts; not used here.
//
// snapshot/restore preserve the window exactly so a
// restore-and-recompute is deterministic.
//
// Contract:
//   compute(row)   → { bbMean, bbStd, bbUpper, bbLower }
//   snapshot()     → opaque state object
//   restore(snap)  → restores from a previous snapshot
//   reset()        → clears all state
//
// `row.lastPrice` is the only field read. Every other row field
// (openTime, volume, notional, …) is ignored by this computer.
// ──────────────────────────────────────────────────────────────

const BB_PERIOD = 20;
const BB_MULTIPLIER = 2;

export function createBollingerCalc(options = {}) {
	const period = options.period || BB_PERIOD;
	const multiplier = options.multiplier !== undefined ? options.multiplier : BB_MULTIPLIER;

	const window = [];

	return {
		compute(row) {
			const price = row.lastPrice;

			window.push(price);
			if (window.length > period) window.shift();

			const n = window.length;
			let sum = 0;
			for (let i = 0; i < n; i++) sum += window[i];
			const mean = sum / n;

			let variance = 0;
			for (let i = 0; i < n; i++) {
				const d = window[i] - mean;
				variance += d * d;
			}
			const std = Math.sqrt(variance / n);

			return {
				bbMean: mean,
				bbStd: std,
				bbUpper: mean + multiplier * std,
				bbLower: mean - multiplier * std
			};
		},

		snapshot() {
			return { window: window.slice() };
		},

		restore(snap) {
			window.length = 0;
			for (let i = 0; i < snap.window.length; i++) window.push(snap.window[i]);
		},

		reset() {
			window.length = 0;
		}
	};
}

export default createBollingerCalc;