import test from 'node:test';
import assert from 'node:assert/strict';
import { Axis } from '../axes/Axis.js';

test('default numeric tick target increases with band height', () => {
	const plane = {
		_yGroups: {
			price: { _yTop: 0, _yBottom: 200 }
		}
	};
	const axis = new Axis({
		plane,
		bandGroupId: 'price',
		orientation: 'right',
		scale: { domain: [0, 100], range: [200, 0] },
		fontSize: 12
	});

	const shorterBandTickCount = axis._computeMaxTicks();
	plane._yGroups.price._yBottom = 300;
	const tallerBandTickCount = axis._computeMaxTicks();

	assert.equal(shorterBandTickCount, 2);
	assert.equal(tallerBandTickCount, 4);
	assert.ok(tallerBandTickCount > shorterBandTickCount);
});

test('decimal tick mode uses sub-decade steps for a tall price band', () => {
	const height = 600;
	const domain = [5_000_000, 5_100_000];
	const plane = {
		_yGroups: {
			price: { _yTop: 0, _yBottom: height }
		}
	};
	const axis = new Axis({
		plane,
		bandGroupId: 'price',
		orientation: 'right',
		tickStepMode: 'decimal',
		scale: {
			domain,
			range: [height, 0],
			toScreen: value => height - (value - domain[0]) * height /
				(domain[1] - domain[0])
		},
		fontSize: 12
	});

	const tiers = axis._computeTickTiers();
	const rendered = axis._getTickTiers();
	const majorSpacing = tiers.majorStep / (domain[1] - domain[0]) * height;

	assert.ok(tiers.majorStep < domain[1] - domain[0]);
	assert.ok(rendered.majorTicks.length > 2);
	assert.ok(majorSpacing >= 75);
});
