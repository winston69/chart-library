// ──────────────────────────────────────────────────────────────
// indicators/RSI.calc.js
//
// RSI computer. Pure math. Worker-safe — no DOM, no imports.
//
// Wilder's smoothing. Advances once per compute(row) call,
// reading row.lastPrice as the sample price. Maintains a small
// buffer during the warm-up period (the first `period` + 1
// samples) to seed the initial average gain/loss; after warm-up
// the buffer is no longer needed and stays at its final length.
//
// snapshot/restore preserve the warm-up buffer exactly, so a
// restore-and-recompute produces identical values to a single
// forward pass.
//
// Contract:
//   compute(row)   → { rsi }
//   snapshot()     → opaque state object
//   restore(snap)  → restores from a previous snapshot
//   reset()        → clears all state
//
// `row.lastPrice` is the only field read. Every other row field
// (openTime, volume, notional, …) is ignored by this computer.
// ──────────────────────────────────────────────────────────────

const RSI_PERIOD = 14;

export function createRSICalc(options = {}) {
	const period = options.period || RSI_PERIOD;

	let avgGain = null;
	let avgLoss = null;
	let prevClose = null;
	const buf = [];

	return {
		compute(row) {
			const price = row.lastPrice;

			if (prevClose === null) {
				prevClose = price;
				buf.push(price);
				return { rsi: 50 };
			}

			const change = price - prevClose;
			const gain = change > 0 ? change : 0;
			const loss = change < 0 ? -change : 0;
			prevClose = price;

			if (buf.length < period + 1) {
				buf.push(price);
				if (buf.length === period + 1) {
					let totalGain = 0;
					let totalLoss = 0;
					for (let i = 1; i < buf.length; i++) {
						const d = buf[i] - buf[i - 1];
						if (d > 0) totalGain += d;
						else if (d < 0) totalLoss -= d;
					}
					avgGain = totalGain / period;
					avgLoss = totalLoss / period;
				} else {
					return { rsi: 50 };
				}
			} else {
				avgGain = (avgGain * (period - 1) + gain) / period;
				avgLoss = (avgLoss * (period - 1) + loss) / period;
			}

			if (avgLoss === 0) return { rsi: 100 };
			const rs = avgGain / avgLoss;
			return { rsi: 100 - (100 / (1 + rs)) };
		},

		snapshot() {
			return {
				avgGain,
				avgLoss,
				prevClose,
				buf: buf.slice()
			};
		},

		restore(snap) {
			avgGain = snap.avgGain;
			avgLoss = snap.avgLoss;
			prevClose = snap.prevClose;
			buf.length = 0;
			for (let i = 0; i < snap.buf.length; i++) buf.push(snap.buf[i]);
		},

		reset() {
			avgGain = null;
			avgLoss = null;
			prevClose = null;
			buf.length = 0;
		}
	};
}

export default createRSICalc;