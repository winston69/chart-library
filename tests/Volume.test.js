import test from 'node:test';
import assert from 'node:assert/strict';
import { detectVolumeSpike, Volume } from '../indicators/Volume.js';

test('Volume detects a crossing above three times the rolling average', () => {
	assert.deepEqual(detectVolumeSpike(
		{ openTime: 100, volume: 31 },
		10,
		20
	), {
		type: 'VOLUME_SPIKE',
		source: 'volume',
		time: 100,
		message: 'High volume spike detected.',
		severity: 'info'
	});

	assert.equal(detectVolumeSpike({ volume: 30 }, 10, 20), null);
	assert.equal(detectVolumeSpike({ volume: 31 }, 10, 31), null);
});

test('Volume detects a same-bucket spike after the previous row is mutated', () => {
	const plane = {
		resolveYGroup: () => 'volume-group',
		addLayer() {}
	};
	const events = [];
	const volume = new Volume({ plane, onRowUpdate: event => events.push(event) });
	const rows = Array.from({ length: 20 }, (_, index) => ({
		openTime: index,
		volume: 10
	}));
	rows.push({ openTime: 20, eventTime: 1000, volume: 20 });
	volume.setData(rows);
	volume.bars.updateLastPoint = row => Object.assign(rows[rows.length - 1], row);

	Object.assign(rows[rows.length - 1], { eventTime: 1001, volume: 31 });
	volume.appendOrUpdate(rows[rows.length - 1], row => row.openTime);

	assert.equal(events.length, 1);
	assert.equal(events[0].type, 'VOLUME_SPIKE');

	Object.assign(rows[rows.length - 1], { eventTime: 1002, volume: 32 });
	volume.appendOrUpdate(rows[rows.length - 1], row => row.openTime);
	assert.equal(events.length, 1);
});
