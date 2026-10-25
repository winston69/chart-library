import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../index.js';

test('the public entry point exports rendering indicators', () => {
	for (const name of [
		'BaseIndicator',
		'MACD',
		'Bollinger',
		'RSI',
		'SMA',
		'VWMA',
		'Volume'
	]) {
		assert.equal(typeof api[name], 'function', `${name} should be exported`);
	}
});

test('worker calculators are not exported from the public entry point', () => {
	for (const name of [
		'createMACDCalc',
		'createBollingerCalc',
		'createRSICalc',
		'createIndicatorSet'
	]) {
		assert.equal(name in api, false, `${name} should remain worker-only`);
	}
});
