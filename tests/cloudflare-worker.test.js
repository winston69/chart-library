import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare-worker/index.js';

test('allows same-origin API requests without an Origin header', async t => {
	const fetchMock = t.mock.method(globalThis, 'fetch', async () => (
		new Response('{"symbols":[]}', {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		})
	));
	const request = new Request('http://localhost:8787/api/symbol-info');

	const response = await worker.fetch(request, {
		ALLOWED_ORIGIN: 'http://localhost:8787'
	});

	assert.equal(response.status, 200);
	assert.equal(fetchMock.mock.callCount(), 1);
});

test('rejects API requests from disallowed origins', async t => {
	const fetchMock = t.mock.method(globalThis, 'fetch', async () => (
		new Response('{}', { status: 200 })
	));
	const request = new Request('http://localhost:8787/api/symbol-info', {
		headers: { Origin: 'https://other.example' }
	});

	const response = await worker.fetch(request, {
		ALLOWED_ORIGIN: 'http://localhost:8787'
	});

	assert.equal(response.status, 403);
	assert.equal(fetchMock.mock.callCount(), 0);
});
