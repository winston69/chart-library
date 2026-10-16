// ──────────────────────────────────────────────────────────────
// indicators.js
//
// Worker-side registry. Imports every indicator computer and
// exposes:
//
//   COMPUTERS                 — name → computer factory
//   createIndicatorSet(entries, sharedParams) — build a set
//
// This file is the worker's only entry point into the indicators
// directory. It pulls in only `.calc.js` files, which are pure
// math with zero imports, so the worker's import graph stays free
// of anything DOM-touching. The rendering classes under
// `indicators/*.js` (MACD, RSI, Bollinger, SMA, VWMA, Volume)
// are main-thread only and are never imported from here.
//
// Computer contract (each `createXCalc` returns an object with):
//   compute(row)   → { ...derived fields }
//   snapshot()     → opaque state object
//   restore(snap)  → restores from a previous snapshot
//   reset()        → clears all state
//
// `compute(row)` receives the whole row. Each computer reads the
// fields it needs:
//
//   macd       → row.lastPrice
//   rsi        → row.lastPrice
//   bollinger  → row.lastPrice
//   sma        → row.lastPrice (or the source field)
//   vwma       → row.notional / row.volume (or HLC3 × volume)
//
// Reading the whole row keeps the contract uniform and lets a
// computer access any field without a signature change.
//
// `createIndicatorSet` returns:
//   compute(row)   → merges every computer's output into one object
//   snapshot()     → captures every computer's state
//   restore(snap)  → restores every computer's state
//   reset()        → resets every computer
//
// The snapshot/restore pair lets a caller rewind to a known state
// and recompute deterministically. The worker uses it to recompute
// the open bucket from its bucket-start snapshot on every tick
// without drift.
// ──────────────────────────────────────────────────────────────

import { createMACDCalc } from './indicators/MACD.calc.js';
import { createRSICalc } from './indicators/RSI.calc.js';
import { createBollingerCalc } from './indicators/Bollinger.calc.js';
import { createSMACalc } from './indicators/SMA.calc.js';
import { createVWMACalc } from './indicators/VWMA.calc.js';

/**
 * Lookup table of indicator computers. Keys are the indicator
 * names; values are factory functions that return a fresh
 * computer instance.
 *
 * Order matters: `createIndicatorSet` runs the computers in the
 * order their names appear in the input array, so any indicator
 * that depends on another's output should be listed after it.
 * None of the current indicators have dependencies.
 */
export const COMPUTERS = {
	macd: createMACDCalc,
	rsi: createRSICalc,
	bollinger: createBollingerCalc,
	sma: createSMACalc,
	vwma: createVWMACalc
};

/**
 * Normalizes an indicator entry into `{ name, params }`.
 *
 *   'macd'                        → { name: 'macd',  params: {} }
 *   { name: 'sma', periodMs: … }  → { name: 'sma',   params: { periodMs: … } }
 *
 * Anything with a string `name` is treated as a parametrized
 * entry; everything else is treated as a plain name.
 */
function normalizeEntry(entry) {
	if (typeof entry === 'string') {
		return { name: entry, params: {} };
	}
	if (entry && typeof entry === 'object' && typeof entry.name === 'string') {
		const { name, ...params } = entry;
		return { name, params };
	}
	throw new Error(
		`createIndicatorSet: invalid indicator entry ${JSON.stringify(entry)}. ` +
		`Expected a string or an object with a "name" field.`
	);
}

/**
 * Creates an indicator set that runs the named computers in
 * sequence and merges their outputs.
 *
 * @param {(string|{name: string, ...params})[]} entries
 * @param {object} [sharedParams] — merged into every entry's
 *                   params, with per-entry params taking
 *                   precedence. Typical use: `{ bucketMs }`.
 * @returns {{
 *   compute(row): object,
 *   snapshot(): object,
 *   restore(snap): void,
 *   reset(): void
 * }}
 */
export function createIndicatorSet(entries, sharedParams = {}) {
	if (!Array.isArray(entries) || entries.length === 0) {
		throw new Error('createIndicatorSet: entries must be a non-empty array.');
	}

	const resolved = entries.map(entry => {
		const { name, params } = normalizeEntry(entry);
		const factory = COMPUTERS[name];
		if (!factory) {
			throw new Error(
				`createIndicatorSet: unknown indicator "${name}". ` +
				`Known: ${Object.keys(COMPUTERS).join(', ')}`
			);
		}
		return { name, computer: factory({ ...sharedParams, ...params }) };
	});

	return {
		compute(row) {
			let out = null;
			for (let i = 0; i < resolved.length; i++) {
				const partial = resolved[i].computer.compute(row);
				if (out === null) out = partial;
				else Object.assign(out, partial);
			}
			return out;
		},

		snapshot() {
			const out = {};
			for (let i = 0; i < resolved.length; i++) {
				const r = resolved[i];
				out[r.name] = r.computer.snapshot();
			}
			return out;
		},

		restore(snap) {
			for (let i = 0; i < resolved.length; i++) {
				const r = resolved[i];
				if (snap && snap[r.name]) r.computer.restore(snap[r.name]);
			}
		},

		reset() {
			for (let i = 0; i < resolved.length; i++) resolved[i].computer.reset();
		}
	};
}