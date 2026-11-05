import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchLiveLog } from '../utils/LiveLog.js';

test('dispatches worker log messages to AlertCard', () => {
	const logs = [];
	const alertCard = { addAlert: log => logs.push(log) };
	const data = {
		source: 'trades',
		time: Date.UTC(2026, 0, 1),
		message: 'Whale BUY detected: 77,716.9',
		direction: 'bullish'
	};

	assert.equal(dispatchLiveLog({ type: 'log', data }, alertCard), true);
	assert.deepEqual(logs, [data]);
	assert.equal(dispatchLiveLog({ type: 'trade', data }, alertCard), false);
	assert.equal(logs.length, 1);
});
