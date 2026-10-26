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
// Trade buffer
// ------------
// Every trade received is retained in `tradeBuffer` for up to
// `maxData` milliseconds. The buffer survives:
//   - feed pause (stop / start)
//   - timeframe change (config with a new bucketMs)
// and is only cleared on:
//   - symbol/stream change
//   - disconnect
//   - reset
//
// This lets timeframe changes rebucket the existing history
// without re-querying the exchange, and lets a paused feed
// catch up on resume.
//
// Lifecycle
// ---------
// Three orthogonal state flags:
//   - emitting  — ticks flow to the main thread.
//   - connected — the WebSocket is open.
//   - buffering — implicitly, whenever connected.
//
// Message semantics:
//   start      — emitting = true. Connect if not connected.
//                Post the current buffer as a seed, then begin
//                ticking.
//   stop       — emitting = false. WebSocket stays open and
//                keeps buffering.
//   disconnect — emitting = false. Close the WebSocket. Clear
//                the buffer.
//   reset      — disconnect + clear + reconnect (if was
//                emitting) + empty seed.
//   config     — update settings. Reconnect and clear the
//                buffer if symbol/stream changed. Rebucket
//                from the buffer and reseed if bucketMs,
//                windowMs, maxData, eventTimeField, or
//                indicators changed.
//   state      — post the current running/connected state.
//
// Seed mechanism
// --------------
// The `seed` message is preserved. On `start` and on `config`
// (timeframe change), the worker posts the current buffer
// bucketed as a seed. When a Cloudflare Worker provides
// historical klines, the same message carries real history.
//
// Protocol (mirrors chart-demo-feed.js):
//
//   Main → Worker
//     { type: 'config', symbol, stream, bucketMs, tickMs,
//       windowMs, maxData, eventTimeField, indicators }
//     { type: 'start' }
//     { type: 'stop' }
//     { type: 'disconnect' }
//     { type: 'reset' }
//     { type: 'state' }
//
//   Worker → Main
//     { type: 'metadata', priceDecimals, qtyDecimals }
//     { type: 'symbols', data: [symbol, ...] }
//     { type: 'seed',  data: [row, ...] }
//     { type: 'tick',  data: row, isNewBucket }
//     { type: 'state', running, connected }
//     { type: 'error', message }
// ──────────────────────────────────────────────────────────────

import { createIndicatorSet } from './indicators.js';

// ─── Endpoint ───
const WS_URL = 'wss://wsapi.pro.coins.ph/openapi/quote/ws/v3';

// ─── Defaults ───
const DEFAULT_SYMBOL = 'BTCPHP';
const DEFAULT_STREAM = 'trade';
const DEFAULT_BUCKET_MS = 900000;              // 15 minutes
const DEFAULT_TICK_MS = 1000;                  // 1 Hz
const DEFAULT_WINDOW_MS = 86400000;            // 24 hours
const DEFAULT_MAX_DATA = 7 * 86400000;         // 7 days buffer
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
let maxData = DEFAULT_MAX_DATA;
let eventTimeField = DEFAULT_EVENT_TIME_FIELD;
let indicatorEntries = DEFAULT_INDICATORS.slice();
let indicators = createIndicatorSet(indicatorEntries, { bucketMs });

// ─── Runtime state ───
let ws = null;
let emitting = false;
let connected = false;
let reconnectTimer = null;
let reconnectDelay = 1000;
const reconnectBaseMs = 1000;
const reconnectMaxMs = 30000;

// ─── Bucket state ───
let currentBucket = null;
let bucketStartSnap = null;
let lastPrice = null;

// ─── Trade buffer ───
// Chronologically-ordered { price, qty, time } records.
// Bounded by `maxData` in time and MAX_TRADES in count.
const tradeBuffer = [];
const MAX_TRADES = 200000;

// ─── Outbound tick throttle ───
let lastTickAt = 0;

let isSeeding = false;
let seedGeneration = 0;

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function postState() {
	self.postMessage({ type: 'state', running: emitting, connected });
}

function postError(message) {
	self.postMessage({ type: 'error', message });
}

function countDecimals(stepSize) {
	if (typeof stepSize !== 'string' || !/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(stepSize)) {
		return null;
	}
	if (Number(stepSize) <= 0) return null;
	const [coefficient, exponentText] = stepSize.toLowerCase().split('e');
	const fraction = (coefficient.split('.')[1] || '').replace(/0+$/, '');
	const exponent = Number(exponentText || 0);
	return Math.max(0, fraction.length - exponent);
}

function floorToBucket(ms) {
	return Math.floor(ms / bucketMs) * bucketMs;
}

function trimBuffer(now) {
	const cutoff = now - maxData;
	let firstKeep = 0;
	while (firstKeep < tradeBuffer.length && tradeBuffer[firstKeep].time < cutoff) {
		firstKeep++;
	}
	if (firstKeep > 0) tradeBuffer.splice(0, firstKeep);

	// Hard cap in case maxData is very large.
	if (tradeBuffer.length > MAX_TRADES) {
		tradeBuffer.splice(0, tradeBuffer.length - MAX_TRADES);
	}
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

	const prevNotional = row.weightedAvgPrice * (row.volume - quantity);
	row.weightedAvgPrice = row.volume > 0
		? (prevNotional + price * quantity) / row.volume
		: price;

	indicators.restore(bucketStartSnap);
	const fields = indicators.compute(row);
	Object.assign(row, fields);
}

/**
 * Rebuild the candle series from the trade buffer using the
 * current config. Advances the indicator set once per closed
 * bucket. Returns the array of rows; the last entry (if any)
 * is the forming bucket.
 */
function rebucketFromBuffer() {
	indicators = createIndicatorSet(indicatorEntries, { bucketMs });
	currentBucket = null;
	bucketStartSnap = null;

	if (tradeBuffer.length === 0) return [];

	const rows = [];
	let bucketOpenTime = floorToBucket(tradeBuffer[0].time);
	let bucket = openBucket(bucketOpenTime, tradeBuffer[0].price, tradeBuffer[0].time);
	lastPrice = tradeBuffer[0].price;

	for (let i = 0; i < tradeBuffer.length; i++) {
		const t = tradeBuffer[i];
		const tBucket = floorToBucket(t.time);

		if (tBucket > bucketOpenTime) {
			// Close previous bucket.
			rows.push(bucket);
			bucketOpenTime = tBucket;
			bucket = openBucket(bucketOpenTime, t.price, t.time);
		}

		foldTrade(bucket, t.price, t.qty, t.time);
		lastPrice = t.price;
	}

	// The final bucket remains forming.
	currentBucket = bucket;
	// The snapshot for the forming bucket is whatever
	// openBucket last set.
	return rows;
}

// ──────────────────────────────────────────────────────────────
// Outbound tick
// ──────────────────────────────────────────────────────────────

function emitTick(isNewBucket) {
	if (!emitting || !currentBucket) return;
	self.postMessage({
		type: 'tick',
		data: { ...currentBucket },
		isNewBucket: !!isNewBucket
	});
	lastTickAt = Date.now();
}

function maybeEmitTick(force) {
	// Do nothing if we are currently building the initial chart history
	if (!emitting || isSeeding) return;

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
		try { payload = JSON.parse(event.data); } catch { return; }

		if (payload.result !== undefined && payload.id !== undefined) return;
		if (payload.code !== undefined && payload.msg !== undefined) {
			postError(`stream error: ${payload.msg}`);
			return;
		}
		if (payload.e !== 'trade') return;

		const price = Number(payload.p);
		const quantity = Number(payload.q);
		const tradeTime = Number(payload.T);

		if (!isFinite(price) || !isFinite(quantity) || !isFinite(tradeTime)) return;

		// Pass directly to the processor
		processTrade({ price, qty: quantity, time: tradeTime });
	};

	ws.onerror = () => {
		postError('websocket error');
	};

	ws.onclose = (event) => {
		ws = null;
		connected = false;
		postState();

		// Flush any pending bucket.
		if (currentBucket && currentBucket.volume > 0 && emitting) {
			emitTick(true);
		}

		if (!emitting) return;
		if (event.code === 1000) return;

		reconnectTimer = setTimeout(() => {
			reconnectDelay = Math.min(reconnectDelay * 2, reconnectMaxMs);
			connect();
		}, reconnectDelay);
	};
}

function disconnectSocket() {
	if (reconnectTimer !== null) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	if (ws) {
		const socket = ws;
		ws = null;
		try { socket.close(1000, 'client disconnect'); }
		catch { /* already closed */ }
	}
	connected = false;
}

// ──────────────────────────────────────────────────────────────
// Command handlers
// ──────────────────────────────────────────────────────────────

function handleConfig(msg) {
	let connectionChanged = false;
	let timeframeChanged = false;

	if (typeof msg.symbol === 'string' && msg.symbol && msg.symbol !== symbol) {
		symbol = msg.symbol;
		connectionChanged = true;
	}
	if (typeof msg.stream === 'string' && msg.stream && msg.stream !== stream) {
		stream = msg.stream;
		connectionChanged = true;
	}
	if (isFinite(msg.bucketMs) && msg.bucketMs > 0 && msg.bucketMs !== bucketMs) {
		bucketMs = msg.bucketMs;
		timeframeChanged = true;
	}
	if (isFinite(msg.tickMs) && msg.tickMs > 0) tickMs = msg.tickMs;
	if (isFinite(msg.windowMs) && msg.windowMs > 0 && msg.windowMs !== windowMs) {
		windowMs = msg.windowMs;
		timeframeChanged = true;
	}
	if (isFinite(msg.maxData) && msg.maxData > 0 && msg.maxData !== maxData) {
		maxData = msg.maxData;
		timeframeChanged = true;
		trimBuffer(Date.now());
	}
	if (typeof msg.eventTimeField === 'string' && msg.eventTimeField
		&& msg.eventTimeField !== eventTimeField) {
		eventTimeField = msg.eventTimeField;
		timeframeChanged = true;
	}
	if (Array.isArray(msg.indicators) && msg.indicators.length > 0) {
		indicatorEntries = msg.indicators.slice();
		timeframeChanged = true;
	}

	if (connectionChanged) {
		// Symbol or stream changed: full reset.
		seedGeneration++;
		const wasEmitting = emitting;
		emitting = false;
		disconnectSocket();
		tradeBuffer.length = 0;
		currentBucket = null;
		bucketStartSnap = null;
		lastPrice = null;
		indicators = createIndicatorSet(indicatorEntries, { bucketMs });

		if (wasEmitting) {
			emitting = true;
			self.postMessage({ type: 'seed', data: [] });
			connect();
			fetchHistoricalSeed();
		} else {
			self.postMessage({ type: 'seed', data: [] });
		}
	} else if (timeframeChanged) {
		// Rebucket from the buffer and reseed without touching
		// the WebSocket.
		const rows = rebucketFromBuffer();
		self.postMessage({ type: 'seed', data: rows });
		// Emit the forming bucket immediately so the chart shows
		// the current state.
		if (emitting && currentBucket) {
			emitTick(false);
		}
	}

	postState();
}

function start() {
	if (emitting) return;
	emitting = true;

	if (!connected) {
		indicators = createIndicatorSet(indicatorEntries, { bucketMs });

		// 1. Connect WebSocket FIRST to start buffering live trades
		connect();

		// 2. Fetch historical data SECOND and push to queue
		// The queue will process them chronologically!
		fetchHistoricalSeed();

		// We no longer immediately post an empty seed here.
		// The queue will naturally emit ticks once the historical data is processed.
	} else {
		// Already connected; the buffer may have grown during the pause.
		if (tradeBuffer.length > 0) {
			const rows = rebucketFromBuffer();
			self.postMessage({ type: 'seed', data: rows });
		}
		if (currentBucket) emitTick(false);
	}

	postState();
}

function stop() {
	if (!emitting) return;
	emitting = false;
	postState();
}

function disconnect() {
	seedGeneration++;
	emitting = false;
	disconnectSocket();
	tradeBuffer.length = 0;
	currentBucket = null;
	bucketStartSnap = null;
	lastPrice = null;
	indicators = createIndicatorSet(indicatorEntries, { bucketMs });
	postState();
}

function reset() {
	const wasEmitting = emitting;
	disconnect();
	if (wasEmitting) {
		start();
	}
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
			case 'disconnect':
				disconnect();
				break;
			case 'reset':
				reset();
				break;
			case 'state':
				postState();
				break;
			default:
				break;
		}
	} catch (err) {
		self.postMessage({ type: 'error', message: String(err && err.message || err) });
	}
};

// ─── Trade Processing ───
function processTrade(trade) {
	const { price, qty: quantity, time: tradeTime } = trade;

	tradeBuffer.push(trade);
	trimBuffer(tradeTime);

	if (lastPrice === null) {
		lastPrice = price;
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
		currentBucket = null;
		openBucket(tradeBucket, price, tradeTime);
		isNewBucket = true;
	}

	foldTrade(currentBucket, price, quantity, tradeTime);
	maybeEmitTick(isNewBucket);
}

async function fetchHistoricalSeed() {
	const generation = seedGeneration;
	const requestedSymbol = symbol;
	try {
		let priceDecimals = 2;
		let qtyDecimals = 4;
		try {
			const metadataResponse = await fetch('http://localhost:8000/api/symbol-info');
			if (!metadataResponse.ok) {
				throw new Error(`HTTP error! status: ${metadataResponse.status}`);
			}
			const metadata = await metadataResponse.json();
			const payload = metadata && metadata.data !== undefined ? metadata.data : metadata;
			const symbols = payload?.symbols;
			if (!Array.isArray(symbols)) {
				throw new Error('Unexpected exchange info response: symbols array is missing');
			}
			if (generation !== seedGeneration) return;
			const availableSymbols = [...new Set(symbols
				.filter(entry => entry && entry.status === 'trading'
					&& typeof entry.symbol === 'string' && entry.symbol)
				.map(entry => entry.symbol))];
			self.postMessage({ type: 'symbols', data: availableSymbols });
			const symbolInfo = symbols.find(entry => entry && entry.symbol === requestedSymbol);
			if (!symbolInfo) throw new Error(`No symbol metadata found for ${requestedSymbol}`);
			const filters = Array.isArray(symbolInfo.filters) ? symbolInfo.filters : [];
			const priceFilter = filters.find(filter => filter.filterType === 'PRICE_FILTER');
			const lotSizeFilter = filters.find(filter => filter.filterType === 'LOT_SIZE');
			const pricePrecision = countDecimals(priceFilter?.tickSize);
			const quantityPrecision = countDecimals(lotSizeFilter?.stepSize);
			if (pricePrecision === null) {
				console.warn(`Missing valid PRICE_FILTER tickSize for ${requestedSymbol}; using 2 decimals.`);
			} else {
				priceDecimals = pricePrecision;
			}
			if (quantityPrecision === null) {
				console.warn(`Missing valid LOT_SIZE stepSize for ${requestedSymbol}; using 4 decimals.`);
			} else {
				qtyDecimals = quantityPrecision;
			}
		} catch (err) {
			if (generation !== seedGeneration) return;
			console.warn(`Failed to fetch trading precision for ${requestedSymbol}; using defaults: ${err.message}`);
		}
		if (generation !== seedGeneration) return;
		self.postMessage({ type: 'metadata', priceDecimals, qtyDecimals });

		const url = `http://localhost:8000/api/trades?symbol=${encodeURIComponent(requestedSymbol)}&limit=1000`;
		const response = await fetch(url);

		if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
		if (generation !== seedGeneration) return;

		const rawTrades = await response.json();
		if (generation !== seedGeneration) return;
		const tradesArray = Array.isArray(rawTrades) ? rawTrades : (rawTrades.data || rawTrades);

		// 1. Lock ticking
		isSeeding = true;

		// 2. Feed all trades synchronously to the processor
		tradesArray.sort((a, b) => a.time - b.time).forEach(t => {
			processTrade({
				price: parseFloat(t.price),
				qty: parseFloat(t.qty),
				time: t.time
			});
		});

		console.log(`Seeded ${tradesArray.length} historical trades into queue.`);

		// 3. Unlock ticking
		isSeeding = false;

		// 4. Emit the entire history as a single seed message
		const rows = rebucketFromBuffer();
		self.postMessage({ type: 'seed', data: rows });
		console.log(`Emitted seed with ${rows.length} historical candles.`);

		// 5. Immediately emit the current forming bucket
		if (currentBucket) {
			emitTick(false);
		}

	} catch (err) {
		if (generation !== seedGeneration) return;
		isSeeding = false; // Ensure we don't get stuck if fetch fails
		postError(`Failed to fetch historical seed: ${err.message}`);
	}
}