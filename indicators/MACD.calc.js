// ──────────────────────────────────────────────────────────────
// indicators/MACD.calc.js
//
// MACD computer. Pure math. Worker-safe — no DOM, no imports.
//
// Stateful: holds three EMAs (fast, slow, signal). Advances once
// per compute(row) call, reading row.lastPrice as the sample
// price. `snapshot`/`restore` allow the caller to rewind to a
// known state and recompute deterministically — used by the
// worker to recompute the open bucket from its bucket-start
// snapshot on every tick without drift.
//
// Contract:
//   compute(row)   → { macd, macdSignal, macdHistogram }
//   snapshot()     → opaque state object
//   restore(snap)  → restores from a previous snapshot
//   reset()        → clears all state
//
// `row.lastPrice` is the only field read. Every other row field
// (openTime, volume, notional, …) is ignored by this computer.
// ──────────────────────────────────────────────────────────────

const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL = 9;

export function createMACDCalc(options = {}) {
	const fast = options.fast || MACD_FAST;
	const slow = options.slow || MACD_SLOW;
	const signal = options.signal || MACD_SIGNAL;

	const alphaFast = 2 / (fast + 1);
	const alphaSlow = 2 / (slow + 1);
	const alphaSignal = 2 / (signal + 1);

	let emaFast = null;
	let emaSlow = null;
	let emaSignal = null;

	return {
		compute(row) {
			const price = row.lastPrice;

			if (emaFast === null) {
				emaFast = price;
				emaSlow = price;
			} else {
				emaFast = alphaFast * price + (1 - alphaFast) * emaFast;
				emaSlow = alphaSlow * price + (1 - alphaSlow) * emaSlow;
			}
			const macd = emaFast - emaSlow;

			if (emaSignal === null) {
				emaSignal = macd;
			} else {
				emaSignal = alphaSignal * macd + (1 - alphaSignal) * emaSignal;
			}

			return {
				macd,
				macdSignal: emaSignal,
				macdHistogram: macd - emaSignal
			};
		},

		snapshot() {
			return { emaFast, emaSlow, emaSignal };
		},

		restore(snap) {
			emaFast = snap.emaFast;
			emaSlow = snap.emaSlow;
			emaSignal = snap.emaSignal;
		},

		reset() {
			emaFast = null;
			emaSlow = null;
			emaSignal = null;
		}
	};
}

export default createMACDCalc;