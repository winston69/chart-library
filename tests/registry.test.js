import test from 'node:test';
import assert from 'node:assert/strict';
import { createIndicatorSet } from '../indicators.js';

const row = lastPrice => ({ lastPrice });

function assertClose(actual, expected) {
	assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} was not close to ${expected}`);
}

test('createIndicatorSet dispatches configured calculators and merges their outputs', () => {
	const indicators = createIndicatorSet([
		{ name: 'macd', fast: 2, slow: 3, signal: 2 },
		{ name: 'rsi', period: 2 }
	]);

	assert.deepEqual(indicators.compute(row(10)), {
		macd: 0,
		macdSignal: 0,
		macdHistogram: 0,
		rsi: 50
	});

	const output = indicators.compute(row(13));
	assertClose(output.macd, 0.5);
	assertClose(output.macdSignal, 1 / 3);
	assertClose(output.macdHistogram, 1 / 6);
	assert.equal(output.rsi, 50);

	assert.equal(indicators.compute(row(12)).rsi, 75);
});

test('createIndicatorSet snapshot and restore reproduce a forming-row result', () => {
	const indicators = createIndicatorSet([
		{ name: 'macd', fast: 2, slow: 3, signal: 2 },
		{ name: 'rsi', period: 2 }
	]);
	indicators.compute(row(10));
	const bucketStart = indicators.snapshot();

	const expected = indicators.compute(row(13));
	indicators.restore(bucketStart);
	assert.deepEqual(indicators.compute(row(13)), expected);
});

test('createIndicatorSet reset returns all calculators to their initial state', () => {
	const indicators = createIndicatorSet([
		{ name: 'macd', fast: 2, slow: 3, signal: 2 },
		{ name: 'rsi', period: 2 }
	]);
	const initial = indicators.compute(row(10));
	indicators.compute(row(13));

	indicators.reset();

	assert.deepEqual(indicators.compute(row(10)), initial);
});

test('createIndicatorSet rejects empty entries, invalid entries, and unknown names', () => {
	assert.throws(
		() => createIndicatorSet([]),
		{ message: 'createIndicatorSet: entries must be a non-empty array.' }
	);
	assert.throws(
		() => createIndicatorSet([null]),
		/invalid indicator entry null/
	);
	assert.throws(
		() => createIndicatorSet(['missing']),
		/unknown indicator "missing"/
	);
});
