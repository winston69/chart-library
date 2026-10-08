// ──────────────────────────────────────────────────────────────
// demo/indicators.js
//
// Stateful indicator computers. Each computer holds the
// incremental state it needs (EMA values, RSI averages, rolling
// windows) and exposes `compute(price)` returning the derived
// fields for that sample.
//
// `createIndicatorSet(names)` returns an object with:
//   - compute(row)   — runs every registered computer, merges
//                      outputs into one object
//   - reset()        — resets every registered computer
//
// Indicator names are keys of the COMPUTERS map below. To add a
// new indicator:
//   1. Write a `createXxxComputer` function.
//   2. Add it to COMPUTERS.
//   3. Add the derived fields to the outgoing row in the feed.
//   4. Add a rendering factory under `indicators/`.
// ──────────────────────────────────────────────────────────────

// ─── MACD ───
const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL = 9;

export function createMACDComputer() {
	const alphaFast = 2 / (MACD_FAST + 1);
	const alphaSlow = 2 / (MACD_SLOW + 1);
	const alphaSignal = 2 / (MACD_SIGNAL + 1);

	let emaFast = null;
	let emaSlow = null;
	let emaSignal = null;

	return {
		compute(price) {
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
		reset() {
			emaFast = null;
			emaSlow = null;
			emaSignal = null;
		}
	};
}

// ─── RSI ───
const RSI_PERIOD = 14;

export function createRSIComputer() {
	let avgGain = null;
	let avgLoss = null;
	let prevClose = null;
	const buf = [];

	return {
		compute(price) {
			if (prevClose === null) {
				prevClose = price;
				buf.push(price);
				return { rsi: 50 };
			}

			const change = price - prevClose;
			const gain = change > 0 ? change : 0;
			const loss = change < 0 ? -change : 0;
			prevClose = price;

			if (buf.length < RSI_PERIOD + 1) {
				buf.push(price);
				if (buf.length === RSI_PERIOD + 1) {
					let totalGain = 0;
					let totalLoss = 0;
					for (let i = 1; i < buf.length; i++) {
						const d = buf[i] - buf[i - 1];
						if (d > 0) totalGain += d;
						else if (d < 0) totalLoss -= d;
					}
					avgGain = totalGain / RSI_PERIOD;
					avgLoss = totalLoss / RSI_PERIOD;
				} else {
					return { rsi: 50 };
				}
			} else {
				avgGain = (avgGain * (RSI_PERIOD - 1) + gain) / RSI_PERIOD;
				avgLoss = (avgLoss * (RSI_PERIOD - 1) + loss) / RSI_PERIOD;
			}

			if (avgLoss === 0) return { rsi: 100 };
			const rs = avgGain / avgLoss;
			return { rsi: 100 - (100 / (1 + rs)) };
		},
		reset() {
			avgGain = null;
			avgLoss = null;
			prevClose = null;
			buf.length = 0;
		}
	};
}

// ─── Bollinger ───
const BB_PERIOD = 20;
const BB_MULTIPLIER = 2;

export function createBollingerComputer() {
	const window = [];

	return {
		compute(price) {
			window.push(price);
			if (window.length > BB_PERIOD) window.shift();

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
				bbUpper: mean + BB_MULTIPLIER * std,
				bbLower: mean - BB_MULTIPLIER * std
			};
		},
		reset() {
			window.length = 0;
		}
	};
}

// ─── Registry ───

/**
 * Lookup table of indicator computers. Keys are the indicator
 * names; values are factory functions that return a fresh
 * computer instance.
 *
 * Order matters: `createIndicatorSet` runs them in the order
 * their names appear in the input array, so any indicator that
 * depends on another's output should be listed after it. None of
 * the current indicators have dependencies.
 */
export const COMPUTERS = {
	macd: createMACDComputer,
	rsi: createRSIComputer,
	bollinger: createBollingerComputer
};

/**
 * Creates an indicator set that runs the named computers in
 * sequence and merges their outputs.
 *
 * @param {string[]} names — indicator names, e.g. ['macd', 'rsi']
 * @returns {{ compute(row): object, reset(): void }}
 */
export function createIndicatorSet(names) {
	if (!Array.isArray(names) || names.length === 0) {
		throw new Error('createIndicatorSet: names must be a non-empty array.');
	}

	const computers = names.map(name => {
		const factory = COMPUTERS[name];
		if (!factory) {
			throw new Error(
				`createIndicatorSet: unknown indicator "${name}". ` +
				`Known: ${Object.keys(COMPUTERS).join(', ')}`
			);
		}
		return factory();
	});

	return {
		compute(row) {
			const price = row.lastPrice;
			let out = null;
			for (let i = 0; i < computers.length; i++) {
				const partial = computers[i].compute(price);
				if (out === null) out = partial;
				else Object.assign(out, partial);
			}
			return out;
		},
		reset() {
			for (let i = 0; i < computers.length; i++) computers[i].reset();
		}
	};
}