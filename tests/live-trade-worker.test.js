import test from 'node:test';
import assert from 'node:assert/strict';

test('seeds rolling averages from REST trades without emitting them as live trades', async t => {
	const globals = ['self', 'WebSocket', 'fetch'];
	const descriptors = new Map(globals.map(name => [
		name,
		Object.getOwnPropertyDescriptor(globalThis, name)
	]));
	let socket;
	const messages = [];
	const restTrades = Array.from({ length: 1000 }, (_, index) => ({
		price: String(100 + index / 100),
		qty: '10',
		time: Date.now() - 24 * 60 * 60 * 1000 + index * 45000,
		isBuyerMaker: false
	}));
	const lastRestTradeTime = restTrades.at(-1).time;
	const websocketTrades = Array.from({ length: 51 }, (_, index) => ({
		price: Number(restTrades.at(-1).price) + index + 1,
		qty: index + 1,
		time: lastRestTradeTime + index + 1,
		isBuyerMaker: false
	}));
	websocketTrades.push(
		{
			price: Number(restTrades.at(-1).price) + 52,
			qty: 8,
			time: lastRestTradeTime + 52,
			isBuyerMaker: true
		},
		{
			price: Number(restTrades.at(-1).price) + 53,
			qty: 3,
			time: lastRestTradeTime + 53,
			isBuyerMaker: false
		},
		{
			price: Number(restTrades.at(-1).price) + 54,
			qty: 5,
			time: lastRestTradeTime + 54,
			isBuyerMaker: false
		}
	);

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
	assert.equal(
		messages.filter(message => message.type === 'trade').length,
		0,
		'REST seed trades should not be sent to the table'
	);

	for (const websocketTrade of [...websocketTrades, websocketTrades.at(-1)]) {
		socket.onmessage({
			data: JSON.stringify({
				e: 'trade',
				p: String(websocketTrade.price),
				q: String(websocketTrade.qty),
				T: websocketTrade.time,
				m: websocketTrade.isBuyerMaker
			})
		});
	}

	assert.deepEqual(
		[
			messages.filter(message => message.type === 'trade').length,
			messages.find(message => message.type === 'trade').data.aveBuy,
			messages.find(message => message.type === 'trade').data.aveSell,
			messages.filter(message => message.type === 'trade')[49].data.aveBuy,
			messages.filter(message => message.type === 'trade')[50].data.aveBuy,
			messages.filter(message => message.type === 'trade')[51].data.aveSell,
			messages.filter(message => message.type === 'trade')[52].data.aveSell,
			messages.filter(message => message.type === 'trade').at(-1).data.aveBuy,
			messages.filter(message => message.type === 'trade').at(-1).data.aveSell,
			messages.find(message => message.type === 'trade').data.aveBuyValue,
			messages.filter(message => message.type === 'trade')[51].data.aveSellValue,
			messages.find(message => message.type === 'trade').data.totalCount,
			messages.filter(message => message.type === 'trade').at(-1).data.totalCount
		],
		[
			54, 9.82, 0, 25.5, 26.5, 8, 8, 26.56, 8,
			9.82 * 110.99, 8 * 161.99, 1001, 1054
		],
		'BUY trades should not affect the SELL window while both side-specific windows roll independently'
	);
});
