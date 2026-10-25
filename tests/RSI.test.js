import test from 'node:test';
import assert from 'node:assert/strict';
import { createRSICalc } from '../indicators/RSI.calc.js';

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
