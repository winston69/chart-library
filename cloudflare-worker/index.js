const EXCHANGE_API_ORIGIN = 'https://api.pro.coins.ph';
const ROUTES = {
	'/api/trades': '/openapi/quote/v1/trades',
	'/api/klines': '/openapi/quote/v1/klines',
	'/api/symbol-info': '/openapi/v1/exchangeInfo'
};

function corsHeaders(request, env) {
	const headers = new Headers({ 'Vary': 'Origin' });
	const origin = request.headers.get('Origin');

	if (origin && origin === env.ALLOWED_ORIGIN) {
		headers.set('Access-Control-Allow-Origin', origin);
		headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
		headers.set('Access-Control-Allow-Headers', 'Content-Type');
	}

	return headers;
}

function jsonResponse(request, env, body, status) {
	const headers = corsHeaders(request, env);
	headers.set('Content-Type', 'application/json; charset=utf-8');
	headers.set('Cache-Control', 'no-store');
	return new Response(JSON.stringify(body), { status, headers });
}

export default {
	async fetch(request, env) {
		const requestUrl = new URL(request.url);
		const upstreamPath = ROUTES[requestUrl.pathname];
		const origin = request.headers.get('Origin');
		const isAllowedOrigin = origin === env.ALLOWED_ORIGIN;

		if (!upstreamPath) {
			return jsonResponse(request, env, { error: 'Not found' }, 404);
		}

		if (request.method === 'OPTIONS') {
			if (!isAllowedOrigin) {
				return jsonResponse(request, env, { error: 'Origin not allowed' }, 403);
			}
			return new Response(null, {
				status: 204,
				headers: corsHeaders(request, env)
			});
		}

		if (!isAllowedOrigin) {
			return jsonResponse(request, env, { error: 'Origin not allowed' }, 403);
		}

		if (request.method !== 'GET') {
			const response = jsonResponse(request, env, { error: 'Method not allowed' }, 405);
			response.headers.set('Allow', 'GET, OPTIONS');
			return response;
		}

		const upstreamUrl = new URL(upstreamPath, EXCHANGE_API_ORIGIN);
		upstreamUrl.search = requestUrl.search;

		try {
			const upstreamResponse = await fetch(upstreamUrl);
			const headers = corsHeaders(request, env);
			headers.set(
				'Content-Type',
				upstreamResponse.headers.get('Content-Type') || 'application/json'
			);
			headers.set('Cache-Control', 'no-store');

			return new Response(upstreamResponse.body, {
				status: upstreamResponse.status,
				statusText: upstreamResponse.statusText,
				headers
			});
		} catch (error) {
			console.error('Exchange proxy request failed:', error);
			return jsonResponse(
				request,
				env,
				{ error: 'Failed to fetch from exchange' },
				502
			);
		}
	}
};
