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
	let resolveTradesRequest;
	let releaseTrades;
	const tradesRequestStarted = new Promise(resolve => {
		resolveTradesRequest = resolve;
	});
	const restTrades = Array.from({ length: 1000 }, (_, index) => ({
		id: index,
		price: String(100 + index / 100),
		qty: '10',
		time: Date.now() - 24 * 60 * 60 * 1000 + index * 45000,
		isBuyerMaker: false
	}));
	const lastRestTradeTime = restTrades.at(-1).time;
	const websocketTrades = Array.from({ length: 60 }, (_, index) => ({
		id: 2000 + index,
		price: Number(restTrades.at(-1).price) + index + 1,
		qty: index + 1,
		time: lastRestTradeTime + index + 1,
		isBuyerMaker: false
	}));
	websocketTrades.push(
		{
			id: 2060,
			price: Number(restTrades.at(-1).price) + 61,
			qty: 8,
			time: lastRestTradeTime + 61,
			isBuyerMaker: true
		},
		{
			id: 2061,
			price: Number(restTrades.at(-1).price) + 62,
			qty: 3,
			time: lastRestTradeTime + 62,
			isBuyerMaker: false
		},
		{
			id: 2062,
			price: Number(restTrades.at(-1).price) + 63,
			qty: 5,
			time: lastRestTradeTime + 63,
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

		resolveTradesRequest();
		return new Promise(resolve => {
			releaseTrades = () => resolve(Response.json(restTrades));
		});
	};

	t.after(() => {
		for (const [name, descriptor] of descriptors) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else delete globalThis[name];
		}
	});

	await import(`../chart-demo-live.js?test=${Date.now()}`);
	let sendTrade;
	const whaleTrade = {
		id: 1001,
		price: 112,
		qty: 200,
		time: lastRestTradeTime + 2,
		isBuyerMaker: false
	};
	const seedPromise = new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('Timed out waiting for trade seed')), 5000);
		self.postMessage = message => {
			messages.push(message);
			if (message.type === 'seed' && message.data.length > 0) {
				clearTimeout(timer);
				resolve(message.data);
			}
			if (message.type === 'trade' && message.data.id === 1000) {
				sendTrade(whaleTrade);
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

	await tradesRequestStarted;
	sendTrade = trade => socket.onmessage({
		data: JSON.stringify({
			e: 'trade',
			t: trade.id,
			p: String(trade.price),
			q: String(trade.qty),
			T: trade.time,
			m: trade.isBuyerMaker
		})
	});
	const overlapTrade = {
		id: restTrades.at(-1).id,
		price: Number(restTrades.at(-1).price),
		qty: 10,
		time: lastRestTradeTime,
		isBuyerMaker: false
	};
	sendTrade(overlapTrade);
	sendTrade(overlapTrade);
	const queuedTrade = {
		id: 1000,
		price: 111,
		qty: 8,
		time: lastRestTradeTime + 1,
		isBuyerMaker: true
	};
	sendTrade(queuedTrade);
	releaseTrades();

	const rows = await seedPromise;
	assert.ok(rows.length >= 700, `expected hundreds of minute candles, got ${rows.length}`);
	assert.deepEqual(
		rows.map(row => row.openTime),
		rows.map(row => row.openTime).toSorted((a, b) => a - b)
	);
	const liveMessages = messages.filter(message => message.type === 'trade');
	assert.equal(liveMessages.length, 2, 'seed-overlap trades should be dropped and trades queued during replay should be processed');
	assert.deepEqual(
		[
			liveMessages[0].data.id,
			liveMessages[0].data.totalCount,
			liveMessages[0].data.aveBuy,
			liveMessages[0].data.aveSell,
			liveMessages[1].data.id,
			liveMessages[1].data.aveBuy,
			liveMessages[1].data.sig,
			liveMessages[0].data.sig
		],
		[1000, 1001, 10, 8, 1001, 13.8, ['🐋'], ['➖']],
		'the replay should retain seed averages and include whale trades in the BUY window'
	);

	for (const websocketTrade of [...websocketTrades, websocketTrades.at(-1)]) {
		sendTrade(websocketTrade);
	}

	const allLiveMessages = messages.filter(message => message.type === 'trade');
	assert.deepEqual(
		[
			allLiveMessages.length,
			allLiveMessages[0].data.totalCount,
			allLiveMessages[2].data.aveBuy,
			allLiveMessages[61].data.aveBuy,
			allLiveMessages[62].data.aveSell,
			allLiveMessages.at(-1).data.aveBuy,
			allLiveMessages.at(-1).data.aveSell,
			allLiveMessages.at(-1).data.totalCount
		],
		[65, 1001, 13.62, 35.5, 8, 35.2, 8, 1065],
		'60 BUYs should retain only quantities 11 through 60, and SELL averages should remain isolated'
	);
});

test('uses Z-scores for volume signals and handles zero-variance windows', async t => {
	const globals = ['self', 'WebSocket', 'fetch'];
	const descriptors = new Map(globals.map(name => [
		name,
		Object.getOwnPropertyDescriptor(globalThis, name)
	]));
	let socket;
	const messages = [];
	const restTrades = Array.from({ length: 100 }, (_, index) => ({
		id: index,
		price: '100',
		qty: '10',
		time: Date.now() - 100000 + index,
		isBuyerMaker: false
	}));
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

	await import(`../chart-demo-live.js?zscore-test=${Date.now()}`);
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

	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('Timed out waiting for trade seed')), 5000);
		const checkSeed = message => {
			if (message.type === 'seed') {
				clearTimeout(timer);
				resolve();
			}
		};
		self.postMessage = message => {
			messages.push(message);
			checkSeed(message);
		};
	});

	const sendTrade = (id, qty) => socket.onmessage({
		data: JSON.stringify({
			e: 'trade',
			t: id,
			p: '100',
			q: String(qty),
			T: Date.now() + id,
			m: false
		})
	});
	sendTrade(101, 10);
	sendTrade(102, 10);
	sendTrade(103, 10);
	sendTrade(104, 1000);

	const signals = messages
		.filter(message => message.type === 'trade')
		.map(message => message.data.sig);
	assert.deepEqual(signals, [['➖'], ['➖'], ['➖'], ['🐋']]);
});
