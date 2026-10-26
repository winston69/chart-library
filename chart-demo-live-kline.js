// ──────────────────────────────────────────────────────────────
// chart-demo-live-kline.js
//
// Live exchange Kline feed. Runs off the main thread.
//
// Exchange candles are already bucketed. This worker maps their
// REST and WebSocket payloads to chart rows and computes the
// indicator fields consumed by the main thread.
// It also posts symbol precision metadata before its REST seed.
// ──────────────────────────────────────────────────────────────

import { createIndicatorSet } from './indicators.js';

const WS_URL = 'wss://wsapi.pro.coins.ph/openapi/quote/ws/v3';
const DEFAULT_SYMBOL = 'BTCPHP';
const DEFAULT_INTERVAL = '15m';
const DEFAULT_BUCKET_MS = 900000;
const DEFAULT_TICK_MS = 1000;
const DEFAULT_WINDOW_MS = 86400000;
const DEFAULT_MAX_DATA = 7 * 86400000;
const DEFAULT_EVENT_TIME_FIELD = 'eventTime';

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

const DEFAULT_INDICATORS = [
	'macd',
	'rsi',
	'bollinger',
	{ name: 'sma', source: 'close', periodMs: 3600000 },
	{ name: 'vwma', source: 'typical', periodMs: 3600000 }
];

let symbol = DEFAULT_SYMBOL;
let interval = DEFAULT_INTERVAL;
let bucketMs = DEFAULT_BUCKET_MS;
let tickMs = DEFAULT_TICK_MS;
let windowMs = DEFAULT_WINDOW_MS;
let maxData = DEFAULT_MAX_DATA;
let eventTimeField = DEFAULT_EVENT_TIME_FIELD;
let indicatorEntries = DEFAULT_INDICATORS.slice();
let indicators = createIndicatorSet(indicatorEntries, { bucketMs });

let ws = null;
let emitting = false;
let connected = false;
let reconnectTimer = null;
let reconnectDelay = 1000;
const reconnectBaseMs = 1000;
const reconnectMaxMs = 30000;

let currentBucket = null;
let bucketStartSnap = null;
let previousClosePrice = null;
let seedReady = false;
const pendingKlines = new Map();
let lastTickAt = 0;
let seedGeneration = 0;

function postState() {
	self.postMessage({ type: 'state', running: emitting, connected });
}

function postError(message) {
	self.postMessage({ type: 'error', message });
}

function resetCandleState() {
	seedGeneration++;
	currentBucket = null;
	bucketStartSnap = null;
	previousClosePrice = null;
	seedReady = false;
	pendingKlines.clear();
	indicators = createIndicatorSet(indicatorEntries, { bucketMs });
}

function finiteNumber(value, field) {
	const number = Number(value);
	if (!Number.isFinite(number)) {
		throw new Error(`Invalid Kline ${field}`);
	}
	return number;
}

function makeRow(values, prevClose) {
	const volume = values.volume;
	const notional = values.notional;
	return {
		lastPrice: values.close,
		weightedAvgPrice: volume > 0 ? notional / volume : values.close,
		prevClosePrice: prevClose ?? values.open,
		openPrice: values.open,
		highPrice: values.high,
		lowPrice: values.low,
		openTime: values.openTime,
		closeTime: values.closeTime,
		[eventTimeField]: values.eventTime,
		volume,
		notional
	};
}

function mapRestKline(kline) {
	if (!Array.isArray(kline) || kline.length < 7) {
		throw new Error('Unexpected REST Kline format');
	}
	const volume = finiteNumber(kline[5], 'volume');
	const close = finiteNumber(kline[4], 'close');
	const quoteVolume = kline.length > 7 && kline[7] !== undefined
		? finiteNumber(kline[7], 'quote volume')
		: close * volume;
	return makeRow({
		openTime: finiteNumber(kline[0], 'open time'),
		open: finiteNumber(kline[1], 'open'),
		high: finiteNumber(kline[2], 'high'),
		low: finiteNumber(kline[3], 'low'),
		close,
		closeTime: finiteNumber(kline[6], 'close time'),
		eventTime: finiteNumber(kline[6], 'close time'),
		volume,
		notional: quoteVolume
	});
}

function mapWebSocketKline(payload) {
	const kline = payload && payload.k;
	if (!kline || typeof kline !== 'object') return null;

	const volume = finiteNumber(kline.v, 'volume');
	const close = finiteNumber(kline.c, 'close');
	const quoteVolume = kline.q === undefined
		? close * volume
		: finiteNumber(kline.q, 'quote volume');
	return {
		row: makeRow({
			openTime: finiteNumber(kline.t, 'open time'),
			open: finiteNumber(kline.o, 'open'),
			high: finiteNumber(kline.h, 'high'),
			low: finiteNumber(kline.l, 'low'),
			close,
			closeTime: finiteNumber(kline.T, 'close time'),
			eventTime: finiteNumber(payload.E, 'event time'),
			volume,
			notional: quoteVolume
		}),
		closed: kline.x === true
	};
}

function emitTick(isNewBucket) {
	if (!emitting || !currentBucket) return;
	self.postMessage({
		type: 'tick',
		data: { ...currentBucket },
		isNewBucket: !!isNewBucket
	});
	lastTickAt = Date.now();
}

function maybeEmitTick(isNewBucket) {
	if (!emitting) return;
	const now = Date.now();
	if (isNewBucket || now - lastTickAt >= tickMs) {
		emitTick(isNewBucket);
	}
}

function addIndicatorFields(row) {
	Object.assign(row, indicators.compute(row));
	return row;
}

function processKline(row, isClosed = false) {
	if (currentBucket && row.openTime < currentBucket.openTime) return;

	if (!currentBucket || row.openTime > currentBucket.openTime) {
		if (currentBucket) previousClosePrice = currentBucket.lastPrice;
		row.prevClosePrice = previousClosePrice ?? row.openPrice;
		bucketStartSnap = indicators.snapshot();
		currentBucket = addIndicatorFields(row);
		maybeEmitTick(true);
		return;
	}

	row.prevClosePrice = currentBucket.prevClosePrice;
	indicators.restore(bucketStartSnap);
	currentBucket = addIndicatorFields(row);
	maybeEmitTick(isClosed);
}

function processPendingKlines() {
	const pending = Array.from(pendingKlines.values())
		.sort((a, b) => a.row.openTime - b.row.openTime);
	pendingKlines.clear();
	for (const kline of pending) processKline(kline.row, kline.closed);
}

function handleKlineMessage(payload) {
	const normalized = mapWebSocketKline(payload);
	if (!normalized) return;
	if (!seedReady) {
		pendingKlines.set(normalized.row.openTime, normalized);
		return;
	}
	processKline(normalized.row, normalized.closed);
}

function sendSubscribe() {
	if (!ws || ws.readyState !== WebSocket.OPEN) return;
	const streamName = `${symbol.toLowerCase()}@kline_${interval}`;
	ws.send(JSON.stringify({
		method: 'SUBSCRIBE',
		params: [streamName],
		id: Date.now()
	}));
}

function connect() {
	if (ws) return;
	const socket = new WebSocket(WS_URL);
	ws = socket;

	socket.onopen = () => {
		connected = true;
		reconnectDelay = reconnectBaseMs;
		sendSubscribe();
		postState();
	};

	socket.onmessage = (event) => {
		let payload;
		try {
			payload = JSON.parse(event.data);
		} catch {
			return;
		}

		if (!payload || typeof payload !== 'object') return;
		if (payload.result !== undefined && payload.id !== undefined) return;
		if (payload.code !== undefined && payload.msg !== undefined) {
			postError(`stream error: ${payload.msg}`);
			return;
		}

		const message = payload.data || payload;
		if (!message || typeof message !== 'object') return;
		if (message.e !== 'kline') return;
		try {
			handleKlineMessage(message);
		} catch (err) {
			postError(`Invalid Kline WebSocket message: ${err.message}`);
		}
	};

	socket.onerror = () => postError('websocket error');

	socket.onclose = (event) => {
		if (ws !== socket) return;
		ws = null;
		connected = false;
		postState();
		if (!emitting || event.code === 1000) return;

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
		try {
			socket.close(1000, 'client disconnect');
		} catch {
			// The socket may already be closed.
		}
	}
	connected = false;
}

async function fetchHistoricalSeed() {
	const generation = seedGeneration;
	const requestedSymbol = symbol;
	const requestedInterval = interval;
	const historyDepthMs = maxData;
	const startTime = Date.now() - historyDepthMs;
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
			console.warn(`Failed to fetch trading precision for ${requestedSymbol}; using defaults: ${err.message}`);
		}
		if (generation !== seedGeneration) return;
		self.postMessage({ type: 'metadata', priceDecimals, qtyDecimals });

		const url = `http://localhost:8000/api/klines?symbol=${encodeURIComponent(requestedSymbol)}`
			+ `&interval=${encodeURIComponent(requestedInterval)}&startTime=${startTime}&limit=1000`;
		const response = await fetch(url);
		if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

		const raw = await response.json();
		if (generation !== seedGeneration) return;
		const klines = Array.isArray(raw) ? raw : raw && raw.data;
		if (!Array.isArray(klines)) {
			throw new Error('Unexpected REST Kline response');
		}

		const rows = klines
			.map(mapRestKline)
			.filter(row => row.openTime >= startTime)
			.sort((a, b) => a.openTime - b.openTime);

		indicators = createIndicatorSet(indicatorEntries, { bucketMs });
		currentBucket = null;
		bucketStartSnap = null;
		previousClosePrice = null;

		for (const row of rows) {
			row.prevClosePrice = previousClosePrice ?? row.openPrice;
			const snapshot = indicators.snapshot();
			addIndicatorFields(row);
			currentBucket = row;
			bucketStartSnap = snapshot;
			previousClosePrice = row.lastPrice;
		}

		// The last row is retained as the live candle so subsequent
		// exchange updates can replace it from its starting snapshot.
		self.postMessage({ type: 'seed', data: rows });
		seedReady = true;
		processPendingKlines();
	} catch (err) {
		if (generation !== seedGeneration) return;
		postError(`Failed to fetch historical Kline seed: ${err.message}`);
		self.postMessage({ type: 'seed', data: [] });
		seedReady = true;
		processPendingKlines();
	}
}

function handleConfig(msg) {
	const wasEmitting = emitting;
	let refreshSeed = false;

	if (typeof msg.symbol === 'string' && msg.symbol && msg.symbol !== symbol) {
		symbol = msg.symbol;
		refreshSeed = true;
	}
	if (typeof msg.interval === 'string' && msg.interval && msg.interval !== interval) {
		interval = msg.interval;
		refreshSeed = true;
	}
	if (Number.isFinite(msg.bucketMs) && msg.bucketMs > 0 && msg.bucketMs !== bucketMs) {
		bucketMs = msg.bucketMs;
		refreshSeed = true;
	}
	if (Number.isFinite(msg.tickMs) && msg.tickMs > 0) tickMs = msg.tickMs;
	if (Number.isFinite(msg.windowMs) && msg.windowMs > 0) windowMs = msg.windowMs;
	if (Number.isFinite(msg.maxData) && msg.maxData > 0 && msg.maxData !== maxData) {
		maxData = msg.maxData;
		refreshSeed = true;
	}
	if (typeof msg.eventTimeField === 'string' && msg.eventTimeField
		&& msg.eventTimeField !== eventTimeField) {
		eventTimeField = msg.eventTimeField;
		refreshSeed = true;
	}
	if (Array.isArray(msg.indicators) && msg.indicators.length > 0
		&& JSON.stringify(msg.indicators) !== JSON.stringify(indicatorEntries)) {
		indicatorEntries = msg.indicators.slice();
		refreshSeed = true;
	}

	if (refreshSeed) {
		emitting = false;
		disconnectSocket();
		resetCandleState();
		self.postMessage({ type: 'seed', data: [] });
		if (wasEmitting) {
			emitting = true;
			connect();
			fetchHistoricalSeed();
		}
	}
	postState();
}

function start() {
	if (emitting) return;
	emitting = true;

	if (!connected) {
		resetCandleState();
		connect();
		fetchHistoricalSeed();
	} else if (currentBucket) {
		emitTick(false);
	}
	postState();
}

function stop() {
	if (!emitting) return;
	emitting = false;
	postState();
}

function disconnect() {
	emitting = false;
	disconnectSocket();
	resetCandleState();
	postState();
}

function reset() {
	const wasEmitting = emitting;
	disconnect();
	self.postMessage({ type: 'seed', data: [] });
	if (wasEmitting) start();
}

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
		postError(String(err && err.message || err));
	}
};
