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
