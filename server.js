import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const PORT = 8000;
const ROOT = process.cwd(); // Serve from the current directory

// MIME types for static file serving
const MIME_TYPES = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.png': 'image/png',
	'.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
	// ─── 1. Proxy API Requests ───
	if (req.url.startsWith('/api/trades')) {
		// Forward the request to Coins.ph
		const targetUrl = `https://api.pro.coins.ph/openapi/quote/v1/trades${req.url.replace('/api/trades', '')}`;
		console.log("api:", targetUrl);

		https.get(targetUrl, (apiRes) => {
			// Copy status code
			res.writeHead(apiRes.statusCode, {
				// Add CORS headers so your browser accepts the response
				'Access-Control-Allow-Origin': '*',
				'Content-Type': 'application/json'
			});
			// Pipe the data straight through
			apiRes.pipe(res);
		}).on('error', (err) => {
			console.error('Proxy Error:', err.message);
			res.writeHead(500, { 'Access-Control-Allow-Origin': '*' });
			res.end(JSON.stringify({ error: 'Failed to fetch from exchange' }));
		});
		return; // Exit early, we handled the request
	}

	// ─── 2. Serve Static Files ───
	// Default to index.html if root is requested
	let filePath = path.join(ROOT, req.url === '/' ? 'index.html' : req.url);

	// Prevent directory traversal attacks
	if (!filePath.startsWith(ROOT)) {
		res.writeHead(403);
		res.end('Forbidden');
		return;
	}

	fs.readFile(filePath, (err, data) => {
		if (err) {
			res.writeHead(404);
			res.end('Not Found');
			return;
		}

		const ext = path.extname(filePath);
		const contentType = MIME_TYPES[ext] || 'application/octet-stream';

		res.writeHead(200, { 'Content-Type': contentType });
		res.end(data);
	});
});

server.listen(PORT, () => {
	console.log(`✅ Server running at http://localhost:${PORT}`);
	console.log(`✅ Proxying exchange API at http://localhost:${PORT}/api/trades`);
});