import test from 'node:test';
import assert from 'node:assert/strict';
import { createRSICalc } from '../indicators/RSI.calc.js';
import { detectRSICross, RSI } from '../indicators/RSI.js';

const row = lastPrice => ({ lastPrice });

function assertClose(actual, expected) {
	assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} was not close to ${expected}`);
}

test('RSI computes the expected values for a small price sequence', () => {
	const rsi = createRSICalc({ period: 3 });

	assert.deepEqual(rsi.compute(row(10)), { rsi: 50 });
	assert.deepEqual(rsi.compute(row(12)), { rsi: 50 });
	assert.deepEqual(rsi.compute(row(11)), { rsi: 50 });
	assertClose(rsi.compute(row(14)).rsi, 100 * 5 / 6);
	assertClose(rsi.compute(row(13)).rsi, 100 * 2 / 3);
	assertClose(rsi.compute(row(12)).rsi, 100 * 20 / 39);
});

test('RSI snapshot and restore reproduce the next result', () => {
	const rsi = createRSICalc({ period: 3 });
	for (const price of [10, 12, 11, 14]) rsi.compute(row(price));
	const snapshot = rsi.snapshot();

	const expected = rsi.compute(row(13));
	rsi.restore(snapshot);
	assert.deepEqual(rsi.compute(row(13)), expected);
});

test('RSI reset returns the calculator to its initial state', () => {
	const rsi = createRSICalc({ period: 3 });
	const initial = rsi.compute(row(10));
	for (const price of [12, 11, 14]) rsi.compute(row(price));

	rsi.reset();

	assert.deepEqual(rsi.compute(row(10)), initial);
});

test('RSI detects overbought and oversold crossings', () => {
	assert.deepEqual(detectRSICross(
		{ rsi: 70 },
		{ openTime: 100, eventTime: 101, rsi: 71 }
	), {
		type: 'RSI_OVERBOUGHT',
		time: 101,
		message: 'RSI is overbought (>70). Potential pullback.',
		direction: 'bearish',
		severity: 'warning'
	});

	assert.deepEqual(detectRSICross(
		{ rsi: 30 },
		{ openTime: 200, rsi: 29 }
	), {
		type: 'RSI_OVERSOLD',
		time: 200,
		message: 'RSI is oversold (<30). Potential bounce.',
		direction: 'bullish',
		severity: 'info'
	});

	assert.equal(detectRSICross({ rsi: 70 }, { rsi: 70 }), null);
	assert.equal(detectRSICross({ rsi: 29 }, { rsi: 28 }), null);
	assert.equal(detectRSICross({ rsi: 29 }, { rsi: 31 }), null);
});

test('RSI detects a same-bucket crossover after the previous row is mutated', () => {
	const plane = {
		resolveYGroup: () => 'rsi-group',
		addLayer() {}
	};
	const events = [];
	const rsi = new RSI({
		plane,
		showLevels: false,
		onRowUpdate: event => events.push(event)
	});
	const rows = [{ openTime: 100, eventTime: 1000, rsi: 65 }];
	rsi.setData(rows);
	rsi.line.updateLastPoint = row => Object.assign(rows[0], row);

	Object.assign(rows[0], { eventTime: 1001, rsi: 72 });
	rsi.appendOrUpdate(rows[0], row => row.openTime);

	assert.equal(events.length, 1);
	assert.equal(events[0].type, 'RSI_OVERBOUGHT');
	assert.equal(events[0].time, 1001);
});
