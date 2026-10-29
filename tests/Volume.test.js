import test from 'node:test';
import assert from 'node:assert/strict';
import { detectVolumeSpike } from '../indicators/Volume.js';

test('Volume detects a crossing above three times the rolling average', () => {
	assert.deepEqual(detectVolumeSpike(
		{ openTime: 100, volume: 31 },
		10,
		20
	), {
		type: 'VOLUME_SPIKE',
		time: 100,
		message: 'High volume spike detected.',
		severity: 'info'
	});

	assert.equal(detectVolumeSpike({ volume: 30 }, 10, 20), null);
	assert.equal(detectVolumeSpike({ volume: 31 }, 10, 31), null);
});
