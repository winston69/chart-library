// ──────────────────────────────────────────────────────────────
// chart-demo-feed.js
//
// Simulated live market data feed. Runs off the main thread.
//
// Row shape:
//   {
//     lastPrice, weightedAvgPrice, prevClosePrice,
//     openPrice, highPrice, lowPrice,
//     openTime, closeTime, eventTime,
//     bbMean, bbStd, bbUpper, bbLower,
//     volume,
//     macd, macdSignal, macdHistogram
//   }
// ──────────────────────────────────────────────────────────────

// ─── Config ───
let intervalMs = 1000;
let windowMs = 900000;
let initialCount = windowMs / intervalMs;
let eventTimeField = 'eventTime';

// MACD periods
const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL = 9;

// Bollinger periods
const BB_PERIOD = 20;
const BB_MULTIPLIER = 2;

// ─── Runtime state ───
let timer = null;
let running = false;

// ─── Feed state ───
let data = [];
let lastPrice = 0.0003619;
let lastWAP = 0.0003615;

// MACD state
let emaFast = null;
let emaSlow = null;
let emaSignal = null;

// ──────────────────────────────────────────────────────────────
// Statistics
// ──────────────────────────────────────────────────────────────

/**
 * Rolling mean and std over the last `period` samples of `field`.
 * Walks backward from the newest sample.
 */
function rollingMeanStd(history, field, period) {
	const n = history.length;
	if (n === 0) return { mean: 0, std: 0 };

	const count = n < period ? n : period;
	let sum = 0;
	for (let i = n - count; i < n; i++) sum += history[i][field];
	const mean = sum / count;

	let variance = 0;
	for (let i = n - count; i < n; i++) {
		const d = history[i][field] - mean;
		variance += d * d;
	}
	const std = Math.sqrt(variance / count);

	return { mean, std };
}

function applyBollingerFields(row, history) {
	const { mean, std } = rollingMeanStd(history, 'lastPrice', BB_PERIOD);
	row.bbMean = mean;
	row.bbStd = std;
	row.bbUpper = mean + BB_MULTIPLIER * std;
	row.bbLower = mean - BB_MULTIPLIER * std;
}

// ──────────────────────────────────────────────────────────────
// MACD
// ──────────────────────────────────────────────────────────────

// EMA_t = alpha * price_t + (1 - alpha) * EMA_{t-1}
// alpha = 2 / (period + 1)
//
// Seeded with the first observed price. The first ~3*period samples
// are warmup — the EMAs haven't converged, and the MACD values are
// exaggerated. Standard convention.
function updateMACD(price) {
	const alphaFast = 2 / (MACD_FAST + 1);
	const alphaSlow = 2 / (MACD_SLOW + 1);
	const alphaSignal = 2 / (MACD_SIGNAL + 1);

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
}

function resetMACD() {
	emaFast = null;
	emaSlow = null;
	emaSignal = null;
}

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

	// Volume — correlated with the price move magnitude.
	const moveMag = Math.abs(newClose - openPrice) / (openPrice || 1);
	const volumeBase = 1200;
	const volumeNoise = 0.6 + Math.random() * 0.8;
	const volumeSpike = 1 + moveMag * 500;
	const volume = Math.round(volumeBase * volumeNoise * volumeSpike);

	// MACD always updates from the new close.
	const macdValues = updateMACD(newClose);

	const round = v => Math.round(v * 1e7) / 1e7;

	lastPrice = newClose;
	lastWAP = newWAP;

	return {
		lastPrice: round(newClose),
		weightedAvgPrice: round(newWAP),

		prevClosePrice: round(prevClose),
		openPrice: round(openPrice),
		highPrice: round(highPrice),
		lowPrice: round(lowPrice),
		openTime,
		closeTime,
		eventTime,

		bbMean: 0,
		bbStd: 0,
		bbUpper: 0,
		bbLower: 0,

		volume,

		macd: macdValues.macd,
		macdSignal: macdValues.macdSignal,
		macdHistogram: macdValues.macdHistogram
	};
}

// ──────────────────────────────────────────────────────────────
// Seed
// ──────────────────────────────────────────────────────────────

function generateSeed(count) {
	data = [];
	lastPrice = 0.0003619;
	lastWAP = 0.0003615;
	resetMACD();

	const now = Date.now();
	const startTime = now - (count - 1) * intervalMs;

	const out = new Array(count);

	for (let i = 0; i < count; i++) {
		const eventTime = startTime + i * intervalMs;
		const row = generateRow(eventTime);
		data.push(row);
		trimToWindow(eventTime);
		applyBollingerFields(row, data);
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
	applyBollingerFields(row, data);
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