import test from 'node:test';
import assert from 'node:assert/strict';
import {
	calculateBandLayout,
	calculateMargins,
	calculatePlotArea
} from '../core/ChartLayout.js';
import { CartesianPlane } from '../core/CartesianPlane.js';

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

test('autoFitVisibleY aggregates visible layer domains and pads each band', () => {
	const plane = new CartesianPlane({ xDomain: [0, 10] });
	const yScale = { domain: [-100, 100] };
	const makeLayer = (min, max) => ({
		isDataLayer: true,
		getVisibleDomain: () => ({ min, max })
	});
	plane._yGroups.price = {
		rows: [
			{ chart: makeLayer(2, 8) },
			{ chart: makeLayer(-2, 12) }
		],
		domain: [-100, 100],
		yScale,
		_yRange: [100, 0],
		_yTop: 0,
		_yBottom: 100,
		yLocked: false
	};
	plane._requestUpdate = () => {};

	plane.autoFitVisibleY();

	assert.deepEqual(yScale.domain, [-2.14, 12.14]);
	assert.deepEqual(plane._yGroups.price.domain, [-2.14, 12.14]);
});

test('autoFitVisibleY leaves y-locked bands unchanged', () => {
	const plane = new CartesianPlane({ xDomain: [0, 10] });
	const yScale = { domain: [-5, 5] };
	plane._yGroups.price = {
		rows: [{
			chart: {
				isDataLayer: true,
				getVisibleDomain: () => ({ min: 0, max: 100 })
			}
		}],
		domain: [-5, 5],
		yScale,
		yLocked: true
	};

	plane.autoFitVisibleY();

	assert.deepEqual(yScale.domain, [-5, 5]);
});

test('autoFitVisibleY uses the default domain when no layer data is visible', () => {
	const plane = new CartesianPlane({ xDomain: [20, 30] });
	const yScale = { domain: [-5, 5] };
	plane._yGroups.price = {
		rows: [{
			chart: {
				isDataLayer: true,
				getStats: () => ({ hasData: true }),
				getVisibleDomain: () => ({ min: 0, max: 1, hasData: false })
			}
		}],
		domain: [-5, 5],
		yScale,
		yLocked: false
	};
	plane._requestUpdate = () => {};

	plane.autoFitVisibleY();

	assert.deepEqual(yScale.domain, [0, 1]);
});

test('X zoom anchor keeps the right gap constant in pixels across zoom levels', () => {
	const plane = new CartesianPlane({
		width: 800,
		xDomain: [0, 100],
		padding: 0.05
	});
	plane.xScale.range = [0, 800];
	plane._requestUpdate = () => {};
	const dataRight = 95;

	const assertFixedGap = () => {
		const anchor = plane.getXZoomAnchor();
		assert.equal(plane.xScale.toScreen(anchor), plane.plotRight - 40);
		assert.equal(plane.xScale.toScreen(dataRight), plane.plotRight - 40);
	};

	assertFixedGap();
	plane.zoom(2, plane.getXZoomAnchor(), 'x');
	assertFixedGap();
});

test('X zoom-out clamps to the largest span that keeps all data visible', () => {
	const plane = new CartesianPlane({
		width: 800,
		xDomain: [0, 100],
		padding: 0.05
	});
	plane.xScale.range = [0, 800];
	plane._dataLayers = ['price'];
	plane._layers.price = {
		instance: {
			isDataLayer: true,
			getStats: () => ({ hasData: true, xMin: 0, xMax: 95 })
		}
	};
	plane.autoFitVisibleY = () => plane;
	plane._requestUpdate = () => {};

	plane.zoom(0.1, plane.getXZoomAnchor(), 'x');

	const [xMin, xMax] = plane.xScale.domain;
	assert.equal(xMin, 0);
	assert.equal(xMax, 100);
	assert.equal(plane.xScale.toScreen(95), plane.plotRight - 40);
});
