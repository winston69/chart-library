// ──────────────────────────────────────────────────────────────
// chart-demo-live.js
//
// Live exchange feed. Runs off the main thread.
//
// Connects to the public <symbol>@trade WebSocket stream,
// buckets trades into fixed-width candles, computes derived
// indicators, and posts the forming bucket to the main thread
// on a 1 Hz cadence (or immediately when a bucket rolls over).
//
// Protocol (mirrors chart-demo-feed.js):
//
//   Main → Worker
//     { type: 'config', symbol, stream, bucketMs, tickMs,
//       windowMs, eventTimeField, indicators }
//     { type: 'start' }
//     { type: 'stop' }
//     { type: 'reset' }
//
//   Worker → Main
//     { type: 'seed',  data: [row, ...] }
//     { type: 'tick',  data: row }
//     { type: 'state', running, connected }
//     { type: 'error', message }
// ──────────────────────────────────────────────────────────────

import { createIndicatorSet } from './indicators.js';

// ─── Endpoint ───
const WS_URL = 'wss://wsapi.pro.coins.ph/openapi/quote/ws/v3';

// ─── Defaults ───
const DEFAULT_SYMBOL = 'BTCPHP';
const DEFAULT_STREAM = 'trade';
const DEFAULT_BUCKET_MS = 900000;       // 15 minutes
const DEFAULT_TICK_MS = 1000;           // 1 Hz
const DEFAULT_WINDOW_MS = 86400000;     // 24 hours
const DEFAULT_EVENT_TIME_FIELD = 'eventTime';

const DEFAULT_INDICATORS = [
	'macd',
	'rsi',
	'bollinger',
	{ name: 'sma', source: 'close', periodMs: 3600000 },
	{ name: 'vwma', source: 'typical', periodMs: 3600000 }
];

// ─── Config ───
let symbol = DEFAULT_SYMBOL;
let stream = DEFAULT_STREAM;
let bucketMs = DEFAULT_BUCKET_MS;
let tickMs = DEFAULT_TICK_MS;
let windowMs = DEFAULT_WINDOW_MS;
let eventTimeField = DEFAULT_EVENT_TIME_FIELD;
let indicatorEntries = DEFAULT_INDICATORS.slice();
let indicators = createIndicatorSet(indicatorEntries, { bucketMs });

// ─── Runtime state ───
let ws = null;
let running = false;
let connected = false;
let reconnectTimer = null;
let reconnectDelay = 1000;
const reconnectBaseMs = 1000;
const reconnectMaxMs = 30000;

// ─── Bucket state ───
let currentBucket = null;
let bucketStartSnap = null;
let lastPrice = null;

// ─── Outbound tick throttle ───
let lastTickAt = 0;

// ─── History ───
// Closed bucket rows. Retained for window trimming and so the
// seed can be rebuilt on reconnect.
let data = [];

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function postState() {
	self.postMessage({ type: 'state', running, connected });
}

function postError(message) {
	self.postMessage({ type: 'error', message });
}

function floorToBucket(ms) {
	return Math.floor(ms / bucketMs) * bucketMs;
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
// Bucket management
// ──────────────────────────────────────────────────────────────

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
		? (prevNotional + price * quantity) / row.volume
		: price;

	indicators.restore(bucketStartSnap);
	const fields = indicators.compute(row);
	Object.assign(row, fields);
}

/**
 * Close the current bucket and push it into history. Called on a
 * bucket boundary.
 */
function finalizeBucket() {
	if (currentBucket && currentBucket.volume > 0) {
		data.push(currentBucket);
		trimToWindow(currentBucket[eventTimeField]);
	}
	currentBucket = null;
}

// ──────────────────────────────────────────────────────────────
// Seed
// ──────────────────────────────────────────────────────────────
// The exchange does not expose historical trade data over HTTP
// with CORS, so the chart starts with a synthetic seed anchored
// to the first live trade price. Live buckets append on top.

function buildSeed(anchorPrice) {
	const count = Math.max(2, Math.round(windowMs / bucketMs));
	const now = Date.now();
	const startTime = floorToBucket(now) - count * bucketMs;

	// Random walk backward from the anchor.
	let price = anchorPrice;
	const prices = new Array(count);
	for (let i = count - 1; i >= 0; i--) {
		prices[i] = price;
		const drift = (Math.random() - 0.5) * 0.005;
		price = price * (1 - drift);
	}

	// Guard against runaway drift.
	const ratio = prices[0] / anchorPrice;
	if (ratio < 0.5 || ratio > 2) {
		for (let i = 0; i < count; i++) prices[i] = anchorPrice;
	}

	indicators = createIndicatorSet(indicatorEntries, { bucketMs });

	const rows = new Array(count);
	for (let i = 0; i < count; i++) {
		const openTime = startTime + i * bucketMs;
		const close = prices[i];
		const prevClose = i === 0 ? close : prices[i - 1];
		const openPrice = prevClose;
		const wick = Math.abs(close - openPrice) + close * 0.001;
		const highPrice = Math.max(openPrice, close) + Math.random() * wick;
		const lowPrice = Math.min(openPrice, close) - Math.random() * wick;
		const volume = Math.round(500 + Math.random() * 1500);
		const notional = close * volume;

		const row = {
			lastPrice: close,
			weightedAvgPrice: close,
			prevClosePrice: prevClose,
			openPrice,
			highPrice,
			lowPrice,
			openTime,
			closeTime: openTime + bucketMs,
			[eventTimeField]: openTime + bucketMs - 1,
			volume,
			notional
		};

		Object.assign(row, indicators.compute(row));
		rows[i] = row;
	}

	return rows;
}

// ──────────────────────────────────────────────────────────────
// Outbound tick
// ──────────────────────────────────────────────────────────────

function emitTick(isNewBucket) {
	if (!currentBucket) return;
	self.postMessage({
		type: 'tick',
		data: { ...currentBucket },
		isNewBucket: !!isNewBucket
	});
	lastTickAt = Date.now();
}

function maybeEmitTick(force) {
	const now = Date.now();
	if (force || now - lastTickAt >= tickMs) {
		emitTick(force);
	}
}

// ──────────────────────────────────────────────────────────────
// WebSocket
// ──────────────────────────────────────────────────────────────

function sendSubscribe() {
	if (!ws || ws.readyState !== WebSocket.OPEN) return;
	const streamName = `${symbol.toLowerCase()}@${stream}`;
	ws.send(JSON.stringify({
		method: 'SUBSCRIBE',
		params: [streamName],
		id: Date.now()
	}));
}

function connect() {
	if (ws) return;

	ws = new WebSocket(WS_URL);

	ws.onopen = () => {
		connected = true;
		reconnectDelay = reconnectBaseMs;
		sendSubscribe();
		postState();
	};

	ws.onmessage = (event) => {
		let payload;
		try { payload = JSON.parse(event.data); }
		catch { return; }

		// Subscription acks.
		if (payload.result !== undefined && payload.id !== undefined) return;

		// Error frames.
		if (payload.code !== undefined && payload.msg !== undefined) {
			postError(`stream error: ${payload.msg}`);
			return;
		}

		// Trade frames.
		if (payload.e !== 'trade') return;

		const price = Number(payload.p);
		const quantity = Number(payload.q);
		const tradeTime = Number(payload.T);

		if (!isFinite(price) || !isFinite(quantity) || !isFinite(tradeTime)) return;

		// First trade: emit the seed, then start the current bucket.
		if (lastPrice === null) {
			lastPrice = price;
			const seedRows = buildSeed(price);
			data = seedRows.slice();
			trimToWindow(seedRows[seedRows.length - 1][eventTimeField]);
			self.postMessage({ type: 'seed', data: seedRows });

			const openTime = floorToBucket(tradeTime);
			openBucket(openTime, price, tradeTime);
		}

		lastPrice = price;

		const tradeBucket = floorToBucket(tradeTime);
		let isNewBucket = false;

		if (!currentBucket) {
			openBucket(tradeBucket, price, tradeTime);
			isNewBucket = true;
		} else if (tradeBucket > currentBucket.openTime) {
			finalizeBucket();
			openBucket(tradeBucket, price, tradeTime);
			isNewBucket = true;
		}

		foldTrade(currentBucket, price, quantity, tradeTime);
		maybeEmitTick(isNewBucket);
	};

	ws.onerror = () => {
		postError('websocket error');
	};

	ws.onclose = (event) => {
		ws = null;
		connected = false;
		postState();

		// Flush any pending bucket.
		if (currentBucket && currentBucket.volume > 0) {
			finalizeBucket();
			emitTick(true);
		}

		if (!running) return;
		if (event.code === 1000) return;  // clean close

		reconnectTimer = setTimeout(() => {
			reconnectDelay = Math.min(reconnectDelay * 2, reconnectMaxMs);
			connect();
		}, reconnectDelay);
	};
}

function disconnect() {
	if (reconnectTimer !== null) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}

	if (ws) {
		const socket = ws;
		ws = null;
		try { socket.close(1000, 'client stop'); }
		catch { /* already closed */ }
	}

	connected = false;
	postState();
}

// ──────────────────────────────────────────────────────────────
// Command handlers
// ──────────────────────────────────────────────────────────────

function handleConfig(msg) {
	let reconfigure = false;

	if (typeof msg.symbol === 'string' && msg.symbol && msg.symbol !== symbol) {
		symbol = msg.symbol;
		reconfigure = true;
	}
	if (typeof msg.stream === 'string' && msg.stream && msg.stream !== stream) {
		stream = msg.stream;
		reconfigure = true;
	}
	if (isFinite(msg.bucketMs) && msg.bucketMs > 0 && msg.bucketMs !== bucketMs) {
		bucketMs = msg.bucketMs;
		reconfigure = true;
	}
	if (isFinite(msg.tickMs) && msg.tickMs > 0) tickMs = msg.tickMs;
	if (isFinite(msg.windowMs) && msg.windowMs > 0) windowMs = msg.windowMs;
	if (typeof msg.eventTimeField === 'string' && msg.eventTimeField) {
		eventTimeField = msg.eventTimeField;
	}
	if (Array.isArray(msg.indicators) && msg.indicators.length > 0) {
		indicatorEntries = msg.indicators.slice();
	}

	indicators = createIndicatorSet(indicatorEntries, { bucketMs });

	// If a connection-relevant option changed while running,
	// disconnect and reconnect with the new parameters.
	if (reconfigure && running) {
		stop();
		start();
	}
}

function start() {
	if (running) return;
	running = true;

	currentBucket = null;
	bucketStartSnap = null;
	lastPrice = null;
	lastTickAt = 0;
	data = [];
	indicators = createIndicatorSet(indicatorEntries, { bucketMs });

	postState();
	connect();
}

function stop() {
	if (!running) return;
	running = false;

	disconnect();

	// Flush any pending bucket.
	if (currentBucket && currentBucket.volume > 0) {
		finalizeBucket();
		emitTick(true);
	}
	currentBucket = null;
	bucketStartSnap = null;

	postState();
}

function reset() {
	const wasRunning = running;
	stop();
	if (wasRunning) start();
}

// ──────────────────────────────────────────────────────────────
// Message handler
// ──────────────────────────────────────────────────────────────

self.onmessage = (evt) => {
	const msg = evt.data;
	if (!msg || typeof msg.type !== 'string') return;

	try {
		switch (msg.type) {
			case 'config':
				handleConfig(msg);
				break;
			case 'start':
				start();
				break;
			case 'stop':
				stop();
				break;
			case 'reset':
				reset();
				break;
			default:
				break;
		}
	} catch (err) {
		self.postMessage({ type: 'error', message: String(err && err.message || err) });
	}
};