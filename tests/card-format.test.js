import test from 'node:test';
import assert from 'node:assert/strict';
import { InfoCard } from '../cards/InfoCard.js';
import { Legend } from '../cards/Legend.js';
import { OHLCCard } from '../cards/OHLCCard.js';

function textElement() {
	return { textContent: '' };
}

test('Legend default values include thousands separators', () => {
	const legend = new Legend();
	const valueEl = textElement();
	legend._itemList = [{
		layer: {
			getStats: () => ({ hasData: true, lastY: 5079123.45 })
		},
		valueEl
	}];

	legend._updateValues();

	assert.equal(valueEl.textContent, '5,079,123.45');
});

test('InfoCard formats metrics and point counts with thousands separators', () => {
	const card = new InfoCard({
		layer: {
			decimals: 2,
			getStats: () => ({
				hasData: true,
				yMin: 5079123.45,
				yMax: 5079129.45,
				lastY: 5079125.45
			}),
			getData: () => new Array(1234)
		},
		plane: { plotHeight: 100 }
	});
	card._root = {};
	for (const item of Object.values(card.items)) item.valueEl = textElement();

	card.update();

	assert.equal(card.items.points.valueEl.textContent, '1,234');
	assert.equal(card.items.min.valueEl.textContent, '5,079,123.45');
	assert.equal(card.items.max.valueEl.textContent, '5,079,129.45');
	assert.equal(card.items.lastY.valueEl.textContent, '5,079,125.45');
});

test('OHLCCard formats OHLC and volume values', () => {
	const row = {
		open: 5079123.45,
		high: 5079129.45,
		low: 5079119.45,
		close: 5079125.45,
		volume: 1234.5,
		openTime: 0
	};
	const layer = {
		decimals: 2,
		getData: () => [row],
		openAccessor: datum => datum.open,
		highAccessor: datum => datum.high,
		lowAccessor: datum => datum.low,
		closeAccessor: datum => datum.close
	};
	const card = new OHLCCard({
		layer,
		decimals: 2,
		volumeDecimals: 4
	});
	for (const item of Object.values(card.items)) item.e = textElement();

	card._applyValues();

	assert.equal(card.items.Open.e.textContent, '5,079,123.45');
	assert.equal(card.items.High.e.textContent, '5,079,129.45');
	assert.equal(card.items.Low.e.textContent, '5,079,119.45');
	assert.equal(card.items.Close.e.textContent, '5,079,125.45');
	assert.equal(card.items.Volume.e.textContent, '1,234.5000');
});
