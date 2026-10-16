// ──────────────────────────────────────────────────────────────
// chart-demo-feed.js
//
// Simulated live market data feed. Runs off the main thread.
//
// Generates trades internally, buckets them into fixed-width
// candles (bucketMs), and posts the forming bucket to the main
// thread at tickMs cadence. On a bucket boundary the previous
// bucket is already final (its last emitted row was its close),
// and the new bucket starts.
//
// Derived fields (MACD, RSI, Bollinger, SMA, VWMA) come from
// `indicators.js`. The indicator set advances exactly once per
// closed bucket; the open bucket is recomputed from a snapshot
// taken at bucket open so the forming candle's indicators track
// the live close without double-advancing.
//
// Protocol:
//
//   Main → Worker
//     { type: 'config', bucketMs, tickMs, windowMs,
//       eventTimeField, indicators }
//     { type: 'seed' }
//     { type: 'start' }
//     { type: 'stop' }
//     { type: 'reset' }
//     { type: 'tick' }        // manual step, emits one tick now
//
//   Worker → Main
//     { type: 'seed',  data: [row, ...] }
//     { type: 'tick',  data: row }
//     { type: 'state', running }
//     { type: 'error', message }
// ──────────────────────────────────────────────────────────────

import { createIndicatorSet } from './indicators.js';

// ─── Defaults ───
const DEFAULT_BUCKET_MS = 900000;       // 15 minutes
const DEFAULT_TICK_MS = 1000;           // 1 Hz
const DEFAULT_WINDOW_MS = 86400000;     // 24 hours
const DEFAULT_EVENT_TIME_FIELD = 'eventTime';
const DEFAULT_START_PRICE = 5176795.70;

const DEFAULT_INDICATORS = [
	'macd',
	'rsi',
	'bollinger',
	{ name: 'sma', source: 'close', periodMs: 3600000 },
	{ name: 'vwma', source: 'typical', periodMs: 3600000 }
];

// ─── Config ───
let bucketMs = DEFAULT_BUCKET_MS;
let tickMs = DEFAULT_TICK_MS;
let windowMs = DEFAULT_WINDOW_MS;
let eventTimeField = DEFAULT_EVENT_TIME_FIELD;
let indicatorEntries = DEFAULT_INDICATORS.slice();

// ─── Runtime state ───
let timer = null;
let running = false;
let indicators = createIndicatorSet(indicatorEntries, { bucketMs });

// ─── Feed state ───
let data = [];                          // closed bucket rows
let lastPrice = DEFAULT_START_PRICE;
let lastWAP = DEFAULT_START_PRICE;

// ─── Bucket state ───
// currentBucket is the forming row. bucketStartSnap is the
// indicator state captured just before the first compute() of
// this bucket, so we can recompute the open row deterministically
// on every tick without advancing state.
let currentBucket = null;
let bucketStartSnap = null;

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function round7(v) { return Math.round(v * 1e7) / 1e7; }

function floorToBucket(ms) {
	return Math.floor(ms / bucketMs) * bucketMs;
}

function nextPrice(lastValue, maxChangeFraction) {
	const change = (Math.random() - 0.5) * 2 * maxChangeFraction;
	const value = Math.max(1e-9, lastValue * (1 + change));
	return round7(value);
}

function trimToWindow(now) {
	const cutoff = now - windowMs;
	let firstKeep = 0;
	while (
		firstKeep < data.length &&
		data[firstKeep].openTime < cutoff
	) {
		firstKeep++;
	}
	if (firstKeep > 0) data.splice(0, firstKeep);
}

// ──────────────────────────────────────────────────────────────
// Bucket construction
// ──────────────────────────────────────────────────────────────

/**
 * Open a new bucket. If a previous bucket exists, advance the
 * indicator set using its close before snapshotting for the new
 * one.
 */
function openBucket(openTime, price, time) {
	if (currentBucket && currentBucket.lastPrice !== null) {
		indicators.compute({ lastPrice: currentBucket.lastPrice });
	}

	const snap = indicators.snapshot();

	const row = {
		lastPrice: price,
		weightedAvgPrice: price,
		prevClosePrice: price,
		openPrice: price,
		highPrice: price,
		lowPrice: price,
		openTime,
		closeTime: openTime + bucketMs,
		[eventTimeField]: time,
		volume: 0,
		notional: 0
	};

	currentBucket = row;
	bucketStartSnap = snap;
	return row;
}

/**
 * Fold a trade into the current bucket row. Updates OHLCV and
 * recomputes indicators from bucketStartSnap.
 */
function foldTrade(row, price, quantity, time) {
	if (row.volume === 0) {
		row.openPrice = price;
		row.highPrice = price;
		row.lowPrice = price;
	}
	row.lastPrice = price;
	if (price > row.highPrice) row.highPrice = price;
	if (price < row.lowPrice) row.lowPrice = price;
	row.volume += quantity;
	row.notional += price * quantity;
	row[eventTimeField] = time;

	// Running WAP approximation.
	const prevNotional = row.weightedAvgPrice * (row.volume - quantity);
	row.weightedAvgPrice = row.volume > 0
		? round7((prevNotional + price * quantity) / row.volume)
		: price;

	// Recompute indicators from the bucket-start snapshot so the
	// open bucket's values are a pure function of (state at open,
	// current close).
	indicators.restore(bucketStartSnap);
	const fields = indicators.compute(row);
	Object.assign(row, fields);
}

/**
 * Generate one simulated trade against the running price.
 */
function makeTrade(time) {
	const price = nextPrice(lastPrice, 0.002);
	const moveMag = Math.abs(price - lastPrice) / (lastPrice || 1);
	const quantity = Math.max(1, Math.round(20 * (0.5 + Math.random()) * (1 + moveMag * 200)));
	lastWAP = nextPrice(lastWAP, 0.001);
	lastPrice = price;
	return { price, quantity, time };
}

// ──────────────────────────────────────────────────────────────
// Tick
// ──────────────────────────────────────────────────────────────

/**
 * Advance the simulation by one outbound tick. May generate one
 * or more internal trades. Posts the current bucket row.
 */
function generateTick() {
	const now = Date.now();

	const trades = 1 + Math.floor(Math.random() * 4);

	for (let i = 0; i < trades; i++) {
		const tradeTime = now - Math.floor(Math.random() * tickMs);
		const tradeBucket = floorToBucket(tradeTime);

		if (currentBucket === null) {
			openBucket(tradeBucket, lastPrice, tradeTime);
		} else if (tradeBucket > currentBucket.openTime) {
			data.push(currentBucket);
			trimToWindow(currentBucket[eventTimeField]);
			openBucket(tradeBucket, lastPrice, tradeTime);
		}

		const trade = makeTrade(tradeTime);
		foldTrade(currentBucket, trade.price, trade.quantity, trade.time);
	}

	return currentBucket;
}

// ──────────────────────────────────────────────────────────────
// Seed
// ──────────────────────────────────────────────────────────────

/**
 * Build a closed-bucket history covering windowMs, ending at the
 * current bucket. The indicator set is advanced through all
 * seeded buckets in order.
 */
function generateSeed() {
	data = [];
	lastPrice = DEFAULT_START_PRICE;
	lastWAP = DEFAULT_START_PRICE;
	indicators = createIndicatorSet(indicatorEntries, { bucketMs });

	const now = Date.now();
	const currentBucketOpen = floorToBucket(now);
	const count = Math.max(2, Math.round(windowMs / bucketMs));
	const startTime = currentBucketOpen - count * bucketMs;

	const out = new Array(count);

	for (let i = 0; i < count; i++) {
		const openTime = startTime + i * bucketMs;
		const tradeTime = openTime + Math.floor(Math.random() * bucketMs);

		openBucket(openTime, lastPrice, tradeTime);

		const tradeCount = 5 + Math.floor(Math.random() * 15);
		for (let t = 0; t < tradeCount; t++) {
			const tTime = openTime + Math.floor(Math.random() * bucketMs);
			const trade = makeTrade(tTime);
			foldTrade(currentBucket, trade.price, trade.quantity, trade.time);
		}

		out[i] = currentBucket;
		data.push(currentBucket);
		currentBucket = null;
	}

	// Advance indicator state once past the last seeded bucket so
	// the first live bucket's snapshot is consistent.
	if (out.length > 0) {
		indicators.compute({ lastPrice: out[out.length - 1].lastPrice });
	}
	bucketStartSnap = null;

	trimToWindow(now);
	return out;
}

// ──────────────────────────────────────────────────────────────
// Timer
// ──────────────────────────────────────────────────────────────

function startTimer() {
	if (running) return;
	running = true;

	timer = setInterval(() => {
		try {
			const row = generateTick();
			self.postMessage({ type: 'tick', data: { ...row }, isNewBucket: false });
		} catch (err) {
			self.postMessage({ type: 'error', message: String(err && err.message || err) });
		}
	}, tickMs);

	postState();
}

function stopTimer() {
	if (!running) return;
	running = false;

	if (timer !== null) {
		clearInterval(timer);
		timer = null;
	}

	postState();
}

function postState() {
	self.postMessage({ type: 'state', running });
}

// ──────────────────────────────────────────────────────────────
// Message handler
// ──────────────────────────────────────────────────────────────

self.onmessage = (evt) => {
	const msg = evt.data;
	if (!msg || typeof msg.type !== 'string') return;

	try {
		switch (msg.type) {
			case 'config': {
				if (isFinite(msg.bucketMs) && msg.bucketMs > 0) bucketMs = msg.bucketMs;
				if (isFinite(msg.tickMs) && msg.tickMs > 0) tickMs = msg.tickMs;
				if (isFinite(msg.windowMs) && msg.windowMs > 0) windowMs = msg.windowMs;
				if (typeof msg.eventTimeField === 'string' && msg.eventTimeField) {
					eventTimeField = msg.eventTimeField;
				}
				if (Array.isArray(msg.indicators) && msg.indicators.length > 0) {
					indicatorEntries = msg.indicators.slice();
				}
				indicators = createIndicatorSet(indicatorEntries, { bucketMs });
				break;
			}

			case 'seed': {
				const seed = generateSeed();
				self.postMessage({ type: 'seed', data: seed });
				break;
			}

			case 'start': {
				startTimer();
				break;
			}

			case 'stop': {
				stopTimer();
				break;
			}

			case 'reset': {
				stopTimer();
				data = [];
				lastPrice = DEFAULT_START_PRICE;
				lastWAP = DEFAULT_START_PRICE;
				indicators = createIndicatorSet(indicatorEntries, { bucketMs });
				currentBucket = null;
				bucketStartSnap = null;
				const seed = generateSeed();
				self.postMessage({ type: 'seed', data: seed });
				break;
			}

			case 'tick': {
				const row = generateTick();
				self.postMessage({ type: 'tick', data: { ...row }, isNewBucket: false });
				break;
			}

			default:
				break;
		}
	} catch (err) {
		self.postMessage({ type: 'error', message: String(err && err.message || err) });
	}
};