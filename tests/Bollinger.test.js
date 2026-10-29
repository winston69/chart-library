import test from 'node:test';
import assert from 'node:assert/strict';
import { detectBollingerBreakout } from '../indicators/Bollinger.js';

test('Bollinger detects upper and lower band breakouts', () => {
	assert.deepEqual(detectBollingerBreakout(
		{ lastPrice: 100, bbUpper: 105, bbLower: 95 },
		{ openTime: 100, lastPrice: 106, bbUpper: 105, bbLower: 95 }
	), {
		type: 'BB_UPPER_BREAKOUT',
		time: 100,
		message: 'Price broke above Upper Bollinger Band.',
		direction: 'bullish',
		severity: 'info'
	});

	assert.deepEqual(detectBollingerBreakout(
		{ close: 100, bbUpper: 105, bbLower: 95 },
		{ openTime: 200, close: 94, bbUpper: 105, bbLower: 95 }
	), {
		type: 'BB_LOWER_BREAKOUT',
		time: 200,
		message: 'Price broke below Lower Bollinger Band.',
		direction: 'bearish',
		severity: 'warning'
	});
});

test('Bollinger does not report a breakout without a crossing or valid prices', () => {
	assert.equal(detectBollingerBreakout(
		{ lastPrice: 106, bbUpper: 105, bbLower: 95 },
		{ lastPrice: 107, bbUpper: 105, bbLower: 95 }
	), null);
	assert.equal(detectBollingerBreakout(
		{ lastPrice: 100, bbUpper: 105, bbLower: 95 },
		{ lastPrice: undefined, bbUpper: 105, bbLower: 95 }
	), null);
	assert.equal(detectBollingerBreakout(
		{ lastPrice: 100, bbUpper: 105 },
		{ lastPrice: 106, bbUpper: 105 }
	).type, 'BB_UPPER_BREAKOUT');
});
