import test from 'node:test';
import assert from 'node:assert/strict';
import { createMACDCalc } from '../indicators/MACD.calc.js';
import { detectMACDCross, MACD } from '../indicators/MACD.js';

const row = lastPrice => ({ lastPrice });

function assertClose(actual, expected) {
	assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} was not close to ${expected}`);
}

test('MACD computes the expected values for a small price sequence', () => {
	const macd = createMACDCalc({ fast: 2, slow: 3, signal: 2 });

	assert.deepEqual(macd.compute(row(10)), {
		macd: 0,
		macdSignal: 0,
		macdHistogram: 0
	});

	const second = macd.compute(row(13));
	assertClose(second.macd, 0.5);
	assertClose(second.macdSignal, 1 / 3);
	assertClose(second.macdHistogram, 1 / 6);

	const third = macd.compute(row(12));
	assertClose(third.macd, 0.25);
	assertClose(third.macdSignal, 5 / 18);
	assertClose(third.macdHistogram, -1 / 36);
});

test('MACD snapshot and restore reproduce the next result', () => {
	const macd = createMACDCalc({ fast: 2, slow: 3, signal: 2 });
	macd.compute(row(10));
	macd.compute(row(13));
	const snapshot = macd.snapshot();

	const expected = macd.compute(row(12));
	macd.restore(snapshot);
	assert.deepEqual(macd.compute(row(12)), expected);
});

test('MACD detects bullish and bearish signal crossings', () => {
	assert.deepEqual(detectMACDCross(
		{ macd: 1, macdSignal: 2 },
		{ openTime: 100, eventTime: 101, macd: 3, macdSignal: 2 }
	), {
		type: 'MACD_CROSS_BULLISH',
		time: 101,
		message: 'MACD crossed above Signal'
	});

	assert.deepEqual(detectMACDCross(
		{ macd: 2, macdSignal: 1 },
		{ openTime: 200, macd: 1, macdSignal: 2 }
	), {
		type: 'MACD_CROSS_BEARISH',
		time: 200,
		message: 'MACD crossed below Signal'
	});

	assert.equal(detectMACDCross(
		{ macd: 1, macdSignal: 2 },
		{ openTime: 300, macd: 2, macdSignal: 2 }
	), null);
	assert.equal(detectMACDCross(
		{ macd: 1, macdSignal: 2 },
		{ openTime: 400, macd: undefined, macdSignal: 2 }
	), null);
});

test('MACD reports a crossover between updates to the same forming bucket', () => {
	const plane = {
		resolveYGroup: () => 'macd-group',
		addLayer() {}
	};
	const events = [];
	const macd = new MACD({
		plane,
		showHistogram: false,
		showSignalLine: false,
		onRowUpdate: event => events.push(event)
	});
	const keyFn = row => row.openTime;

	const rows = [{ openTime: 100, eventTime: 1000, macd: 1, macdSignal: 2 }];
	macd.setData(rows);
	const bullishRow = { openTime: 100, eventTime: 1001, macd: 3, macdSignal: 2 };
	rows[0] = bullishRow;
	macd.appendOrUpdate(bullishRow, keyFn);
	const bearishRow = { openTime: 100, eventTime: 1002, macd: 1, macdSignal: 2 };
	rows[0] = bearishRow;
	macd.appendOrUpdate(bearishRow, keyFn);

	assert.deepEqual(events, [
		{
			type: 'MACD_INIT',
			time: 1000,
			message: 'MACD ready: 1 / Signal: 2'
		},
		{
			type: 'MACD_CROSS_BULLISH',
			time: 1001,
			message: 'MACD crossed above Signal'
		},
		{
			type: 'MACD_CROSS_BEARISH',
			time: 1002,
			message: 'MACD crossed below Signal'
		}
	]);
});

test('MACD emits one initial state alert when seeded with rows', () => {
	const plane = {
		resolveYGroup: () => 'macd-group',
		addLayer() {}
	};
	const events = [];
	const macd = new MACD({
		plane,
		showHistogram: false,
		showSignalLine: false,
		onRowUpdate: event => events.push(event)
	});

	macd.setData([{ openTime: 100, eventTime: 101, macd: 1.25, macdSignal: 0.75 }]);
	macd.setData([{ openTime: 200, macd: 1.5, macdSignal: 1.25 }]);

	assert.deepEqual(events, [{
		type: 'MACD_INIT',
		time: 101,
		message: 'MACD ready: 1.25 / Signal: 0.75'
	}]);
});

test('MACD reset returns the calculator to its initial state', () => {
	const macd = createMACDCalc({ fast: 2, slow: 3, signal: 2 });
	const initial = macd.compute(row(10));
	macd.compute(row(13));

	macd.reset();

	assert.deepEqual(macd.compute(row(10)), initial);
});
