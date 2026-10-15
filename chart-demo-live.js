// ──────────────────────────────────────────────────────────────
// chart-demo-live.js
//
// Live exchange feed. Runs off the main thread.
//
// Connects to the public <symbol>@trade WebSocket stream,
// buckets trades into fixed-width candles, computes derived
// indicators, and posts one row per bucket.
//
// Protocol (mirrors chart-demo-feed.js):
//
//   Main → Worker
//     { type: 'config', symbol, stream, bucketMs, windowMs,
//       eventTimeField, indicators }
//     { type: 'start' }
//     { type: 'stop' }
//     { type: 'reset' }
//
//   Worker → Main
//     { type: 'seed', data: [rowData, ...] }
//     { type: 'tick', data: rowData }
//     { type: 'state', running: boolean, connected: boolean }
//     { type: 'error', message: string }
//
// ──────────────────────────────────────────────────────────────

import { createIndicatorSet } from './indicators.js';

// ─── Endpoint ───
const WS_URL = 'wss://wsapi.pro.coins.ph/openapi/quote/ws/v3';

// ─── Defaults ───
const DEFAULT_SYMBOL = 'BTCPHP';
const DEFAULT_STREAM = 'trade';
const DEFAULT_BUCKET_MS = 60000;
const DEFAULT_WINDOW_MS = 900000 * 4 * 24;
const DEFAULT_EVENT_TIME_FIELD = 'eventTime';
const DEFAULT_INDICATORS = ['macd', 'rsi', 'bollinger'];

// ─── Config ───
let symbol = DEFAULT_SYMBOL;
let stream = DEFAULT_STREAM;
let bucketMs = DEFAULT_BUCKET_MS;
let windowMs = DEFAULT_WINDOW_MS;
let eventTimeField = DEFAULT_EVENT_TIME_FIELD;
let indicators = createIndicatorSet(DEFAULT_INDICATORS);

// ─── Runtime state ───
let ws = null;
let running = false;
let connected = false;
let seeded = false;
let reconnectTimer = null;
let reconnectDelay = 1000;
const reconnectBaseMs = 1000;
const reconnectMaxMs = 30000;

// ─── Bucket state ───
let bucket = null;
let flushTimer = null;

// ─── History ───
// Retained so the seed can rebuild a window-relative history when
// the connection drops and reconnects. Also used for trimming.
let data = [];

// ──────────────────────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────────────────────

function postState() {
	self.postMessage({
		type: 'state',
		running,
		connected
	});
}

function postError(message) {
	self.postMessage({ type: 'error', message });
}

function trimToWindow(now) {
	const cutoff = now - windowMs;
	let firstKeep = 0;
	while (
		firstKeep < data.length &&
		data[firstKeep][eventTimeField] < cutoff
	) {
		firstKeep++;
	}
	if (firstKeep > 0) data.splice(0, firstKeep);
}

// ──────────────────────────────────────────────────────────────
// Bucket management
// ──────────────────────────────────────────────────────────────

function makeBucket(openTime) {
	return {
		openTime,
		closeTime: openTime + bucketMs,
		open: null,
		high: -Infinity,
		low: Infinity,
		close: null,
		volume: 0,
		count: 0
	};
}

function applyTradeToBucket(b, price, quantity) {
	if (b.open === null) {
		b.open = price;
		b.high = price;
		b.low = price;
	} else {
		if (price > b.high) b.high = price;
		if (price < b.low) b.low = price;
	}
	b.close = price;
	b.volume += quantity;
	b.count++;
}

function bucketToRow(b) {
	if (b.count === 0) return null;

	const row = {
		lastPrice: b.close,
		weightedAvgPrice: b.close,
		prevClosePrice: b.open,
		openPrice: b.open,
		highPrice: b.high,
		lowPrice: b.low,
		openTime: b.openTime,
		closeTime: b.closeTime,
		eventTime: b.closeTime,
		volume: b.volume
	};

	// Merge derived fields.
	Object.assign(row, indicators.compute(row));

	return row;
}

function closeBucketAndEmit() {
	if (!bucket || bucket.count === 0) {
		bucket = null;
		return null;
	}
	const row = bucketToRow(bucket);
	bucket = null;
	return row;
}

// ──────────────────────────────────────────────────────────────
// Seed
// ──────────────────────────────────────────────────────────────
// Builds a synthetic history anchored to a price. The exchange
// does not expose historical trade data over HTTP with CORS, so
// the chart starts empty and warms up on live trades. A synthetic
// seed gives the chart a populated window on connect.
//
// The seed count is derived from windowMs / bucketMs so it fits
// the visible window exactly.

function buildSeed(anchorPrice) {
	const count = Math.max(2, Math.round(windowMs / bucketMs));
	const now = Date.now();
	const startTime = now - (count - 1) * bucketMs;

	// Random walk backward from the anchor.
	let price = anchorPrice;
	const prices = new Array(count);
	for (let i = count - 1; i >= 0; i--) {
		prices[i] = price;
		const drift = (Math.random() - 0.5) * 0.005;
		price = price * (1 - drift);
	}

	// Guard against runaway drift.
	const drift = prices[0] / anchorPrice;
	if (drift < 0.5 || drift > 2) {
		for (let i = 0; i < count; i++) prices[i] = anchorPrice;
	}

	indicators.reset();

	const rows = new Array(count);
	for (let i = 0; i < count; i++) {
		const eventTime = startTime + i * bucketMs;
		const close = prices[i];
		const prevClose = i === 0 ? close : prices[i - 1];
		const openPrice = prevClose;
		const wick = Math.abs(close - openPrice) + close * 0.001;
		const highPrice = Math.max(openPrice, close) + Math.random() * wick;
		const lowPrice = Math.min(openPrice, close) - Math.random() * wick;
		const volume = Math.round(500 + Math.random() * 1500);

		const row = {
			lastPrice: close,
			weightedAvgPrice: close,
			prevClosePrice: prevClose,
			openPrice,
			highPrice,
			lowPrice,
			openTime: eventTime - bucketMs,
			closeTime: eventTime,
			eventTime,
			volume
		};

		Object.assign(row, indicators.compute(row));
		rows[i] = row;
	}

	return rows;
}

// ──────────────────────────────────────────────────────────────
// Flush timer
// ──────────────────────────────────────────────────────────────
// Emits the current bucket at the end of each interval, even if
// no trades arrived in it. Keeps the chart ticking during quiet
// periods.

function startFlushTimer() {
	if (flushTimer !== null) return;
	flushTimer = setInterval(() => {
		const now = Date.now();
		if (!bucket) {
			// No bucket open. Start one aligned to now.
			if (seeded) {
				const openTime = Math.floor(now / bucketMs) * bucketMs;
				bucket = makeBucket(openTime);
			}
			return;
		}
		if (now >= bucket.closeTime) {
			const row = closeBucketAndEmit();
			if (row) {
				data.push(row);
				trimToWindow(row.eventTime);
				self.postMessage({ type: 'tick', data: row });
			}
			if (running) {
				const openTime = Math.floor(now / bucketMs) * bucketMs;
				bucket = makeBucket(openTime);
			}
		}
	}, Math.max(100, Math.floor(bucketMs / 2)));
}

function stopFlushTimer() {
	if (flushTimer !== null) {
		clearInterval(flushTimer);
		flushTimer = null;
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

	const streamName = `${symbol.toLowerCase()}@${stream}`;
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

		// First trade: emit a seed, then start the current bucket.
		if (!seeded) {
			seeded = true;
			const seedRows = buildSeed(price);
			data = seedRows.slice();
			trimToWindow(seedRows[seedRows.length - 1][eventTimeField]);
			self.postMessage({ type: 'seed', data: seedRows });

			const openTime = Math.floor(tradeTime / bucketMs) * bucketMs;
			bucket = makeBucket(openTime);
		}

		const bucketOpenTime = Math.floor(tradeTime / bucketMs) * bucketMs;

		if (!bucket) {
			bucket = makeBucket(bucketOpenTime);
		} else if (bucketOpenTime > bucket.openTime) {
			// Emit the closed bucket.
			const row = closeBucketAndEmit();
			if (row) {
				data.push(row);
				trimToWindow(row.eventTime);
				self.postMessage({ type: 'tick', data: row });
			}
			bucket = makeBucket(bucketOpenTime);
		}

		applyTradeToBucket(bucket, price, quantity);
	};

	ws.onerror = () => {
		postError('websocket error');
	};

	ws.onclose = (event) => {
		ws = null;
		connected = false;
		postState();

		// Flush any pending bucket before closing.
		if (bucket && bucket.count > 0) {
			const row = closeBucketAndEmit();
			if (row) {
				data.push(row);
				trimToWindow(row.eventTime);
				self.postMessage({ type: 'tick', data: row });
			}
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
	if (isFinite(msg.windowMs) && msg.windowMs > 0) windowMs = msg.windowMs;
	if (typeof msg.eventTimeField === 'string' && msg.eventTimeField) {
		eventTimeField = msg.eventTimeField;
	}
	if (Array.isArray(msg.indicators) && msg.indicators.length > 0) {
		indicators = createIndicatorSet(msg.indicators);
	}

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
	seeded = false;
	data = [];
	bucket = null;
	indicators.reset();

	postState();
	connect();
	startFlushTimer();
}

function stop() {
	if (!running) return;
	running = false;

	stopFlushTimer();
	disconnect();

	// Flush any pending bucket.
	if (bucket && bucket.count > 0) {
		const row = closeBucketAndEmit();
		if (row) {
			data.push(row);
			self.postMessage({ type: 'tick', data: row });
		}
	}
	bucket = null;

	postState();
}

function reset() {
	// Stop any running session, clear history, and reseed on the
	// next trade. The seed is emitted on the first trade after
	// reconnect, so `start()` handles it.
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

	switch (msg.type) {
		case 'config': {
			handleConfig(msg);
			break;
		}
		case 'start': {
			start();
			break;
		}
		case 'stop': {
			stop();
			break;
		}
		case 'reset': {
			reset();
			break;
		}
		default:
			break;
	}
};