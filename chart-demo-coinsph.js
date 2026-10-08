// ──────────────────────────────────────────────────────────────
// chart-demo-coinsph.js
//
// Coins.ph live feed. Connects to the public 24hr ticker stream,
// synthesizes a seed history anchored to the current price, and
// emits chart-shaped rows to a callback.
//
// REST is not used: the exchange's REST endpoints do not send
// CORS headers. The WebSocket is not subject to CORS and works
// from any origin.
//
// Usage:
//   const feed = createCoinsPhFeed({
//       onSeed: (rows) => { /* hand to chart */ },
//       onTick: (row) => { /* hand to chart */ }
//   });
//   feed.start();
//   feed.stop();
// ──────────────────────────────────────────────────────────────
import { createIndicatorSet } from './indicators.js';

const WS_URL = 'wss://wsapi.pro.coins.ph/openapi/quote/ws/v3';

const SEED_COUNT = 900;
const SEED_INTERVAL_MS = 1000;

export function createCoinsPhFeed(options = {}) {
	const {
		symbol = 'BTCPHP',
		stream = 'ticker',
		seedCount = SEED_COUNT,
		seedIntervalMs = SEED_INTERVAL_MS,
		indicators = ['macd', 'rsi', 'bollinger'],
		onSeed = () => { },
		onTick = () => { },
		onOpen = () => { },
		onClose = () => { },
		onError = () => { },
		reconnect = true,
		reconnectBaseMs = 1000,
		reconnectMaxMs = 30000
	} = options;

	const indicatorSet = createIndicatorSet(indicators);

	let ws = null;
	let reconnectDelay = reconnectBaseMs;
	let reconnectTimer = null;
	let stopped = false;
	let seeded = false;
	let rowCount = 0;

	function enrich(row) {
		Object.assign(row, indicatorSet.compute(row));
		return row;
	}

	// ─── Frame → row adapter ───
	function adapt(frame) {
		return {
			lastPrice: Number(frame.c),
			weightedAvgPrice: Number(frame.w),
			prevClosePrice: Number(frame.x),
			openPrice: Number(frame.o),
			highPrice: Number(frame.h),
			lowPrice: Number(frame.l),
			openTime: frame.O,
			closeTime: frame.C,
			eventTime: frame.E,
			volume: Number(frame.v)
		};
	}

	// ─── Synthetic seed ───
	// Builds a plausible 900-row history ending at the anchor price.
	// The rows carry raw fields only; the caller's indicator set
	// computes derived fields when it consumes them.
	function buildSeed(anchorPrice) {
		const now = Date.now();
		const startTime = now - (seedCount - 1) * seedIntervalMs;
		const rows = new Array(seedCount);

		let price = anchorPrice;
		const prices = new Array(seedCount);
		for (let i = seedCount - 1; i >= 0; i--) {
			prices[i] = price;
			const drift = (Math.random() - 0.5) * 0.005;
			price = price * (1 - drift);
		}
		const drift = prices[0] / anchorPrice;
		if (drift < 0.5 || drift > 2) {
			for (let i = 0; i < seedCount; i++) {
				prices[i] = anchorPrice;
			}
		}

		// Reset the indicator set before seeding so the seed's first
		// sample is treated as a fresh start. Otherwise the EMA state
		// from a prior session would carry over.
		indicatorSet.reset();

		for (let i = 0; i < seedCount; i++) {
			const eventTime = startTime + i * seedIntervalMs;
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
				openTime: eventTime - seedIntervalMs,
				closeTime: eventTime,
				eventTime,
				volume
			};

			// Merge derived fields before storing.
			rows[i] = enrich(row);
		}

		return rows;
	}

	// ─── WebSocket ───
	function connect() {
		if (stopped) return;

		const streamName = `${symbol.toLowerCase()}@${stream}`;
		ws = new WebSocket(WS_URL);

		ws.onopen = () => {
			reconnectDelay = reconnectBaseMs;
			ws.send(JSON.stringify({
				method: 'SUBSCRIBE',
				params: [streamName],
				id: Date.now()
			}));
			onOpen({ symbol, stream: streamName });
		};

		ws.onmessage = (event) => {
			let payload;
			try { payload = JSON.parse(event.data); }
			catch { return; }

			if (payload.result !== undefined && payload.id !== undefined) return;
			if (payload.code !== undefined && payload.msg !== undefined) {
				onError(payload);
				return;
			}
			if (payload.e !== '24hrTicker') return;

			const rawRow = adapt(payload);

			if (!seeded) {
				seeded = true;
				// Seed first — this resets the indicator set and
				// enriches the seed rows. The set now ends at the
				// last seed row's state.
				const seedRows = buildSeed(rawRow.lastPrice);
				onSeed(seedRows);
			}

			// Then enrich the live row. Its derived fields continue
			// from where the seed left off.
			const row = enrich(rawRow);

			rowCount++;
			onTick(row);
		};

		ws.onerror = (event) => {
			onError(event);
		};

		ws.onclose = (event) => {
			ws = null;
			onClose({ code: event.code, reason: event.reason, frames: rowCount });

			if (!reconnect || stopped) return;
			if (event.code === 1000) return;   // clean close, don't reconnect

			reconnectTimer = setTimeout(() => {
				reconnectDelay = Math.min(reconnectDelay * 2, reconnectMaxMs);
				connect();
			}, reconnectDelay);
		};
	}

	return {
		start() {
			stopped = false;
			seeded = false;
			rowCount = 0;
			indicatorSet.reset();
			connect();
		},
		stop() {
			stopped = true;
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
			if (ws) {
				try { ws.close(1000, 'client stop'); }
				catch { /* already closed */ }
				ws = null;
			}
		},
		get isConnected() {
			return ws !== null && ws.readyState === WebSocket.OPEN;
		},
		get frameCount() {
			return rowCount;
		},
		get symbol() {
			return symbol;
		}
	};
}