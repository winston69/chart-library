import test from 'node:test';
import assert from 'node:assert/strict';

test('rebuckets interleaved WebSocket and REST trades chronologically', async t => {
	const globals = ['self', 'WebSocket', 'fetch'];
	const descriptors = new Map(globals.map(name => [
		name,
		Object.getOwnPropertyDescriptor(globalThis, name)
	]));
	let socket;
	const messages = [];
	const restTrades = Array.from({ length: 1000 }, (_, index) => ({
		price: String(100 + index / 100),
		qty: '1',
		time: Date.now() - 24 * 60 * 60 * 1000 + index * 45000
	}));
	const websocketTrade = {
		price: Number(restTrades[restTrades.length - 1].price) + 1,
		qty: 1,
		time: restTrades[restTrades.length - 1].time + 30000
	};

	globalThis.self = {
		location: { origin: 'http://localhost:8787' },
		onmessage: null,
		postMessage: message => messages.push(message)
	};
	globalThis.WebSocket = class {
		static OPEN = 1;
		readyState = 1;
		constructor() { socket = this; }
		send() {}
		close() {}
	};
	globalThis.fetch = async url => {
		if (String(url).includes('/api/symbol-info')) {
			return Response.json({
				symbols: [{
					symbol: 'BTCPHP',
					status: 'trading',
					filters: [
						{ filterType: 'PRICE_FILTER', tickSize: '0.01' },
						{ filterType: 'LOT_SIZE', stepSize: '0.001' }
					]
				}]
			});
		}

		socket.onmessage({
			data: JSON.stringify({
				e: 'trade',
				p: String(websocketTrade.price),
				q: String(websocketTrade.qty),
				T: websocketTrade.time
			})
		});
		socket.onmessage({
			data: JSON.stringify({
				e: 'trade',
				p: String(websocketTrade.price),
				q: String(websocketTrade.qty),
				T: websocketTrade.time
			})
		});
		return Response.json(restTrades);
	};

	t.after(() => {
		for (const [name, descriptor] of descriptors) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else delete globalThis[name];
		}
	});

	await import(`../chart-demo-live.js?test=${Date.now()}`);
	const seedPromise = new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('Timed out waiting for trade seed')), 5000);
		self.postMessage = message => {
			messages.push(message);
			if (message.type === 'seed' && message.data.length > 0) {
				clearTimeout(timer);
				resolve(message.data);
			}
		};
	});

	self.onmessage({ data: {
		type: 'config',
		apiBase: 'http://localhost:8787',
		bucketMs: 60000,
		windowMs: 24 * 60 * 60 * 1000,
		maxData: 7 * 24 * 60 * 60 * 1000,
		eventTimeField: 'eventTime',
		indicators: ['macd']
	} });
	self.onmessage({ data: { type: 'start' } });

	const rows = await seedPromise;
	assert.ok(rows.length >= 700, `expected hundreds of minute candles, got ${rows.length}`);
	assert.deepEqual(
		rows.map(row => row.openTime),
		rows.map(row => row.openTime).toSorted((a, b) => a - b)
	);
	assert.equal(rows.at(-1).volume, 2, 'duplicate WebSocket trade should be skipped');
});
