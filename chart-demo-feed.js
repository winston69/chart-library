// ──────────────────────────────────────────────────────────────
// chart-demo-feed.js
//
// Simulated live market data feed. Runs off the main thread.
//
// Raw fields are generated here. Derived fields (MACD, RSI,
// Bollinger) are computed by `demo/indicators.js`.
// ──────────────────────────────────────────────────────────────

import { createIndicatorSet } from './indicators.js';

// ─── Config ───
let intervalMs = 1000;
let windowMs = 900000;
let initialCount = windowMs / intervalMs;
let eventTimeField = 'eventTime';

// ─── Runtime state ───
let timer = null;
let running = false;

// ─── Feed state ───
let data = [];
let lastPrice = 0.0003619;
let lastWAP = 0.0003615;

// ─── Indicator set ───
const indicators = createIndicatorSet();

// ──────────────────────────────────────────────────────────────
// Generators
// ──────────────────────────────────────────────────────────────

function nextPrice(lastValue, maxChangeFraction) {
	const change = (Math.random() - 0.5) * 2 * maxChangeFraction;
	const value = Math.max(1e-9, lastValue * (1 + change));
	return Math.round(value * 1e7) / 1e7;
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

function generateRow(eventTime) {
	const openTime = eventTime - intervalMs;
	const closeTime = eventTime;

	const prevClose = lastPrice;
	const newClose = nextPrice(lastPrice, 0.005);
	const newWAP = nextPrice(lastWAP, 0.003);

	const openPrice = data.length > 0 ? prevClose : newClose;

	const wick = Math.abs(newClose - openPrice) + newClose * 0.001;
	const highPrice = Math.max(openPrice, newClose) + Math.random() * wick;
	const lowPrice = Math.min(openPrice, newClose) - Math.random() * wick;

	const moveMag = Math.abs(newClose - openPrice) / (openPrice || 1);
	const volumeBase = 1200;
	const volumeNoise = 0.6 + Math.random() * 0.8;
	const volumeSpike = 1 + moveMag * 500;
	const volume = Math.round(volumeBase * volumeNoise * volumeSpike);

	const round = v => Math.round(v * 1e7) / 1e7;

	lastPrice = newClose;
	lastWAP = newWAP;

	const row = {
		lastPrice: round(newClose),
		weightedAvgPrice: round(newWAP),
		prevClosePrice: round(prevClose),
		openPrice: round(openPrice),
		highPrice: round(highPrice),
		lowPrice: round(lowPrice),
		openTime,
		closeTime,
		eventTime,
		volume
	};

	// Merge derived fields into the row.
	Object.assign(row, indicators.compute(row));

	return row;
}

// ──────────────────────────────────────────────────────────────
// Seed
// ──────────────────────────────────────────────────────────────

function generateSeed(count) {
	data = [];
	lastPrice = 0.0003619;
	lastWAP = 0.0003615;
	indicators.reset();

	const now = Date.now();
	const startTime = now - (count - 1) * intervalMs;

	const out = new Array(count);

	for (let i = 0; i < count; i++) {
		const eventTime = startTime + i * intervalMs;
		const row = generateRow(eventTime);
		data.push(row);
		trimToWindow(eventTime);
		out[i] = row;
	}

	return out;
}

// ──────────────────────────────────────────────────────────────
// Tick
// ──────────────────────────────────────────────────────────────

function generateTick() {
	const now = Date.now();
	const row = generateRow(now);
	data.push(row);
	trimToWindow(now);
	return row;
}

// ──────────────────────────────────────────────────────────────
// Timer
// ──────────────────────────────────────────────────────────────

function startTimer() {
	if (running) return;
	running = true;

	timer = setInterval(() => {
		const row = generateTick();
		self.postMessage({ type: 'tick', data: row });
	}, intervalMs);
}

function stopTimer() {
	if (!running) return;
	running = false;

	if (timer !== null) {
		clearInterval(timer);
		timer = null;
	}
}

// ──────────────────────────────────────────────────────────────
// Message handler
// ──────────────────────────────────────────────────────────────

self.onmessage = (evt) => {
	const msg = evt.data;
	if (!msg || typeof msg.type !== 'string') return;

	switch (msg.type) {
		case 'config': {
			if (isFinite(msg.intervalMs) && msg.intervalMs > 0) intervalMs = msg.intervalMs;
			if (isFinite(msg.windowMs) && msg.windowMs > 0) windowMs = msg.windowMs;
			if (typeof msg.eventTimeField === 'string' && msg.eventTimeField) {
				eventTimeField = msg.eventTimeField;
			}
			initialCount = Math.round(windowMs / intervalMs);
			break;
		}

		case 'seed': {
			const seed = generateSeed(initialCount);
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
			const seed = generateSeed(initialCount);
			self.postMessage({ type: 'seed', data: seed });
			break;
		}

		case 'tick': {
			const row = generateTick();
			self.postMessage({ type: 'tick', data: row });
			break;
		}

		default:
			break;
	}
};