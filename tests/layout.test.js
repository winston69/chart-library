import test from 'node:test';
import assert from 'node:assert/strict';
import {
	calculateBandLayout,
	calculateMargins,
	calculatePlotArea
} from '../core/ChartLayout.js';

const noMargins = { top: 0, right: 0, bottom: 0, left: 0 };

test('plot area subtracts each margin from the corresponding dimension', () => {
	assert.deepEqual(calculatePlotArea(600, 400, {
		top: 10, right: 20, bottom: 30, left: 40
	}), {
		left: 40,
		right: 580,
		top: 10,
		bottom: 370,
		width: 540,
		height: 360
	});
});

test('margin calculation takes the largest request on each side', () => {
	assert.deepEqual(calculateMargins([
		{ top: 10, right: 4, bottom: 8, left: 3 },
		{ top: 2, right: 12, bottom: 5, left: 15 },
		null
	]), {
		top: 10, bottom: 8, left: 15, right: 12
	});
});

test('band layout returns zero-height bands when the plot has zero height', () => {
	const layout = calculateBandLayout({
		width: 100,
		height: 20,
		margins: { top: 10, right: 0, bottom: 10, left: 0 },
		bands: [{ id: 'price', height: 1 }]
	});

	assert.equal(layout.height, 0);
	assert.deepEqual(layout.bands[0], {
		id: 'price',
		height: 0,
		normalizedHeight: 1,
		heightFraction: 1,
		top: 10,
		bottom: 10,
		range: [10, 10]
	});
});

test('band layout normalizes ratios and stacks in order from the plot bottom', () => {
	const layout = calculateBandLayout({
		width: 200,
		height: 120,
		margins: noMargins,
		bands: [
			{ id: 'volume', height: 1 },
			{ id: 'price', height: 3 }
		]
	});

	assert.deepEqual(layout.bands.map(({ id, top, bottom, height, heightFraction, range }) => ({
		id, top, bottom, height, heightFraction, range
	})), [
		{
			id: 'volume',
			top: 90,
			bottom: 120,
			height: 30,
			heightFraction: 0.25,
			range: [120, 90]
		},
		{
			id: 'price',
			top: 0,
			bottom: 90,
			height: 90,
			heightFraction: 0.75,
			range: [90, 0]
		}
	]);
});
