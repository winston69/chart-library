import test from 'node:test';
import assert from 'node:assert/strict';
import { createMACDCalc } from '../indicators/MACD.calc.js';

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

test('MACD reset returns the calculator to its initial state', () => {
	const macd = createMACDCalc({ fast: 2, slow: 3, signal: 2 });
	const initial = macd.compute(row(10));
	macd.compute(row(13));

	macd.reset();

	assert.deepEqual(macd.compute(row(10)), initial);
});
