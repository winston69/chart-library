// ──────────────────────────────────────────────────────────────
// indicators/SMA.calc.js
//
// Simple Moving Average computer. Pure math. Worker-safe — no
// DOM, no imports.
//
// Rolling window over the last `periodMs` worth of buckets.
// Period in milliseconds is converted to a bucket count using
// `bucketMs`: periodBuckets = ceil(periodMs / bucketMs).
//
// Advances once per compute(row) call. Reads one field off the
// row, determined by `source`:
//
//   'close'  → row.lastPrice    (default)
//   'open'   → row.openPrice
//   'high'   → row.highPrice
//   'low'    → row.lowPrice
//
// Ring buffer semantics:
//   - If the last buffer entry has the same openTime as the
//     incoming row, its value is replaced. This makes a
//     same-bucket recompute idempotent.
//   - Otherwise a new { openTime, value } entry is pushed.
//   - Entries with openTime <= row.openTime - periodMs are
//     evicted. With periodMs = 3600000 and bucketMs = 900000,
//     this holds exactly 4 entries at steady state.
//
// snapshot/restore preserve the buffer exactly so a
// restore-and-recompute is deterministic.
//
// Contract:
//   compute(row)   → { sma }
//   snapshot()     → opaque state object
//   restore(snap)  → restores from a previous snapshot
//   reset()        → clears all state
// ──────────────────────────────────────────────────────────────

const DEFAULT_SOURCE = 'close';
const DEFAULT_PERIOD_MS = 3600000;      // 1 hour
const DEFAULT_BUCKET_MS = 900000;       // 15 minutes

function readSource(row, source) {
	switch (source) {
		case 'close': return row.lastPrice;
		case 'open': return row.openPrice;
		case 'high': return row.highPrice;
		case 'low': return row.lowPrice;
		default: return row.lastPrice;
	}
}

export function createSMACalc(options = {}) {
	const source = options.source || DEFAULT_SOURCE;
	const periodMs = options.periodMs || DEFAULT_PERIOD_MS;
	const bucketMs = options.bucketMs || DEFAULT_BUCKET_MS;

	const periodBuckets = Math.max(1, Math.ceil(periodMs / bucketMs));

	const buf = [];

	return {
		compute(row) {
			const openTime = row.openTime;
			const value = readSource(row, source);

			// Same bucket: replace the tail entry in place.
			if (buf.length > 0 && buf[buf.length - 1].openTime === openTime) {
				buf[buf.length - 1].value = value;
			} else {
				buf.push({ openTime, value });
			}

			// Evict entries outside the window. Strictly-within:
			// an entry exactly `periodMs` old is dropped.
			const cutoff = openTime - periodMs;
			while (buf.length > 0 && buf[0].openTime <= cutoff) {
				buf.shift();
			}

			const n = buf.length;
			let sum = 0;
			for (let i = 0; i < n; i++) sum += buf[i].value;

			return { sma: n > 0 ? sum / n : value };
		},

		snapshot() {
			return {
				buf: buf.map(e => ({ openTime: e.openTime, value: e.value }))
			};
		},

		restore(snap) {
			buf.length = 0;
			for (let i = 0; i < snap.buf.length; i++) {
				const e = snap.buf[i];
				buf.push({ openTime: e.openTime, value: e.value });
			}
		},

		reset() {
			buf.length = 0;
		}
	};
}

export default createSMACalc;