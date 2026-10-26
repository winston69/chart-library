import test from 'node:test';
import assert from 'node:assert/strict';
import { CartesianPlane } from '../core/CartesianPlane.js';
import { SVG } from '../core/SVG.js';
import { InteractionLayer } from '../interaction/InteractionLayer.js';

function createInteractionPlane() {
	const plane = new CartesianPlane({
		width: 800,
		height: 400,
		xDomain: [0, 100],
		padding: 0.05
	});
	plane.xScale.range = [0, 800];
	plane._requestUpdate = () => {};
	plane._yGroupOrder = ['price'];
	plane._yGroups.price = {
		id: 'price',
		rows: [],
		domain: [-10, 10],
		yScale: new plane.yScale.constructor({
			domain: [-10, 10],
			range: [400, 0]
		}),
		_yTop: 0,
		_yBottom: 400,
		_yRange: [400, 0],
		yLocked: false
	};

	const interaction = new InteractionLayer({ plane });
	let autoFitCount = 0;
	const autoFitVisibleY = plane.autoFitVisibleY.bind(plane);
	plane.autoFitVisibleY = () => {
		autoFitCount++;
		return autoFitVisibleY();
	};

	return { plane, interaction, getAutoFitCount: () => autoFitCount };
}

function withPointerPoint(point, callback) {
	const getPoint = SVG.getPoint;
	SVG.getPoint = () => point;
	try {
		callback();
	} finally {
		SVG.getPoint = getPoint;
	}
}

test('Shift+wheel pans X in the expected direction and auto-fits visible Y', () => {
	const { plane, interaction, getAutoFitCount } = createInteractionPlane();
	let prevented = false;
	const wheelEvent = {
		deltaY: -1,
		shiftKey: true,
		ctrlKey: false,
		preventDefault() { prevented = true; }
	};

	withPointerPoint({ x: 400, y: 200 }, () => interaction._onWheel(wheelEvent));

	assert.deepEqual(plane.xScale.domain, [-10, 90]);
	assert.equal(getAutoFitCount(), 1);
	assert.equal(prevented, true);
});

test('Ctrl+wheel zooms at the cursor, zooms hovered Y, and auto-fits visible Y', () => {
	const { plane, interaction, getAutoFitCount } = createInteractionPlane();
	const anchorX = plane.xScale.toData(200);
	const originalYDomain = plane._yGroups.price.yScale.domain.slice();
	let prevented = false;
	const wheelEvent = {
		deltaY: -1,
		shiftKey: false,
		ctrlKey: true,
		preventDefault() { prevented = true; }
	};

	withPointerPoint({ x: 200, y: 200 }, () => interaction._onWheel(wheelEvent));

	assert.equal(plane.xScale.toScreen(anchorX), 200);
	assert.notDeepEqual(plane._yGroups.price.yScale.domain, originalYDomain);
	assert.equal(getAutoFitCount(), 1);
	assert.equal(prevented, true);
});

test('Ctrl takes precedence when Ctrl and Shift are both pressed', () => {
	const { plane, interaction, getAutoFitCount } = createInteractionPlane();
	const anchorX = plane.xScale.toData(200);
	const wheelEvent = {
		deltaY: -1,
		shiftKey: true,
		ctrlKey: true,
		preventDefault() {}
	};

	withPointerPoint({ x: 200, y: 200 }, () => interaction._onWheel(wheelEvent));

	assert.equal(plane.xScale.toScreen(anchorX), 200);
	assert.notDeepEqual(plane.xScale.domain, [0, 100]);
	assert.equal(getAutoFitCount(), 1);
});
