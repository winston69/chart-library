// ──────────────────────────────────────────────────────────────
// indicators/VWMA.calc.js
//
// Volume-Weighted Moving Average computer. Pure math.
// Worker-safe — no DOM, no imports.
//
// Rolling window over the last `periodMs` worth of buckets.
// Period in milliseconds is converted to a bucket count using
// `bucketMs`: periodBuckets = ceil(periodMs / bucketMs).
//
// VWMA = Σ(notional) / Σ(volume) over the window, where
// `notional` is the price × volume product for each bucket.
// Which price feeds the notional depends on `source`:
//
//   'typical' → notional = ((high + low + close) / 3) × volume
//               computed from the row's fields
//   'exact'   → notional = row.notional
//               (the worker accumulates Σ(price × qty) per bucket)
//
// Both give the same mathematical result if every trade's price
// is used in the typical-price case, but `typical` uses the
// bucket's HLC3 rather than the exact per-trade price. The
// difference is second-order; `typical` matches the standard
// VWAP definition on OHLCV bars, `exact` matches a tick-level
// VWAP.
//
// Ring buffer semantics:
//   - If the last buffer entry has the same openTime as the
//     incoming row, its notional and volume are replaced. This
//     makes a same-bucket recompute idempotent.
//   - Otherwise a new { openTime, notional, volume } entry is
//     pushed.
//   - Entries with openTime <= row.openTime - periodMs are
//     evicted. With periodMs = 3600000 and bucketMs = 900000,
//     this holds exactly 4 entries at steady state.
//
// snapshot/restore preserve the buffer exactly so a
// restore-and-recompute is deterministic.
//
// Contract:
//   compute(row)   → { vwma }
//   snapshot()     → opaque state object
//   restore(snap)  → restores from a previous snapshot
//   reset()        → clears all state
// ──────────────────────────────────────────────────────────────

const DEFAULT_SOURCE = 'typical';
const DEFAULT_PERIOD_MS = 3600000;      // 1 hour
const DEFAULT_BUCKET_MS = 900000;       // 15 minutes

function computeNotional(row, source) {
	if (source === 'exact') {
		return row.notional;
	}
	// 'typical' — HLC3 × volume
	const typical = (row.highPrice + row.lowPrice + row.lastPrice) / 3;
	return typical * row.volume;
}

export function createVWMACalc(options = {}) {
	const source = options.source || DEFAULT_SOURCE;
	const periodMs = options.periodMs || DEFAULT_PERIOD_MS;
	const bucketMs = options.bucketMs || DEFAULT_BUCKET_MS;

	const periodBuckets = Math.max(1, Math.ceil(periodMs / bucketMs));

	const buf = [];

	return {
		compute(row) {
			const openTime = row.openTime;
			const notional = computeNotional(row, source);
			const volume = row.volume;

			// Same bucket: replace the tail entry in place.
			if (buf.length > 0 && buf[buf.length - 1].openTime === openTime) {
				buf[buf.length - 1].notional = notional;
				buf[buf.length - 1].volume = volume;
			} else {
				buf.push({ openTime, notional, volume });
			}

			// Evict entries outside the window. Strictly-within:
			// an entry exactly `periodMs` old is dropped.
			const cutoff = openTime - periodMs;
			while (buf.length > 0 && buf[0].openTime <= cutoff) {
				buf.shift();
			}

			const n = buf.length;
			let sumNotional = 0;
			let sumVolume = 0;
			for (let i = 0; i < n; i++) {
				sumNotional += buf[i].notional;
				sumVolume += buf[i].volume;
			}

			const vwma = sumVolume > 0 ? sumNotional / sumVolume : row.lastPrice;
			return { vwma };
		},

		snapshot() {
			return {
				buf: buf.map(e => ({
					openTime: e.openTime,
					notional: e.notional,
					volume: e.volume
				}))
			};
		},

		restore(snap) {
			buf.length = 0;
			for (let i = 0; i < snap.buf.length; i++) {
				const e = snap.buf[i];
				buf.push({
					openTime: e.openTime,
					notional: e.notional,
					volume: e.volume
				});
			}
		},

		reset() {
			buf.length = 0;
		}
	};
}

export default createVWMACalc;