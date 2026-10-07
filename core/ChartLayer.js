// ──────────────────────────────────────────────────────────────
// ChartLayer.js - Base class for data-contributing layers
// ──────────────────────────────────────────────────────────────

import { Layer } from './Layer.js';

export class ChartLayer extends Layer {
	constructor(o = {}) {
		super(o);
		
		// In ChartLayer constructor:
		this.slot = 'band';     // routed by _yGroupId

		// ─── Mark as data contributor ───
		this.isDataLayer = true;

		// ─── Data ───
		this.data = o.data || [];

		// ─── Accessors ───
		this.xAccessor = o.xAccessor || (d => d.x !== undefined ? d.x : d[0]);
		this.yAccessor = o.yAccessor || (d => d.y !== undefined ? d.y : d[1]);

		// ─── Decimal precision (declared by the data source) ───
		this.decimals = o.decimals !== undefined ? o.decimals : 2;

		// ─── Stats (cache) ───
		this._stats = {
			xMin: Infinity, xMax: -Infinity,
			yMin: Infinity, yMax: -Infinity,
			lastX: null, lastY: null,
			pointCount: 0, hasData: false
		};
	}

	// ──────────────────────────────────────────────────────────
	// STATS (data contribution contract)
	// ──────────────────────────────────────────────────────────

	getStats() {
		const s = this._stats;
		return {
			xMin: s.xMin, xMax: s.xMax,
			yMin: s.yMin, yMax: s.yMax,
			lastX: s.lastX, lastY: s.lastY,
			pointCount: s.pointCount,
			hasData: s.hasData
		};
	}

	getDomain() {
		const s = this._stats;
		return {
			xMin: s.xMin, xMax: s.xMax,
			yMin: s.yMin, yMax: s.yMax,
			hasData: s.hasData
		};
	}

	getData() {
		return this.data;
	}

	// Override in subclasses
	setWindowSize(windowSize) {
		this._windowSize = windowSize;
	}

	// Subclasses call this after data changes
	_recalcStats(data) {
		// Implemented in concrete subclasses
	}
}

export default ChartLayer;