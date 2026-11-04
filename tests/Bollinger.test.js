import test from 'node:test';
import assert from 'node:assert/strict';
import { Bollinger, detectBollingerBreakout } from '../indicators/Bollinger.js';

test('Bollinger detects upper and lower band breakouts', () => {
	assert.deepEqual(detectBollingerBreakout(
		{ lastPrice: 100, bbUpper: 105, bbLower: 95 },
		{ openTime: 100, eventTime: 101, lastPrice: 106, bbUpper: 105, bbLower: 95 }
	), {
		type: 'BB_UPPER_BREAKOUT',
		source: 'bollinger',
		time: 101,
		message: 'Price broke above Upper Band.',
		direction: 'bullish',
		severity: 'info'
	});

	assert.deepEqual(detectBollingerBreakout(
		{ close: 100, bbUpper: 105, bbLower: 95 },
		{ openTime: 200, close: 94, bbUpper: 105, bbLower: 95 }
	), {
		type: 'BB_LOWER_BREAKOUT',
		source: 'bollinger',
		time: 200,
		message: 'Price broke below Lower Band.',
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

test('Bollinger detects same-bucket breakouts after the previous row is mutated', () => {
	const plane = {
		resolveYGroup: () => 'price-group',
		addLayer() {}
	};
	const events = [];
	const bollinger = new Bollinger({
		plane,
		showFill: false,
		showLines: false,
		onRowUpdate: event => events.push(event)
	});
	const rows = [{
		openTime: 100,
		eventTime: 1000,
		lastPrice: 100,
		bbUpper: 105,
		bbLower: 95
	}];
	bollinger.setData(rows);
	bollinger.mean.updateLastPoint = row => Object.assign(rows[0], row);

	Object.assign(rows[0], {
		eventTime: 1001,
		lastPrice: 106,
		bbUpper: 105,
		bbLower: 95
	});
	bollinger.appendOrUpdate(rows[0], row => row.openTime);

	assert.equal(events.length, 1);
	assert.equal(events[0].type, 'BB_UPPER_BREAKOUT');
	assert.equal(events[0].time, 1001);
});
