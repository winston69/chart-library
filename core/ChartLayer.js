// ──────────────────────────────────────────────────────────────
// ChartLayer.js - Base class for data-contributing layers
// ──────────────────────────────────────────────────────────────

import { Layer } from './Layer.js';
import { Events } from './Events.js';

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

		// ─── Tail trimming ───
		// When true, appendPoint / updateLastPoint trim rows older than
		// (lastX - plane.windowSize). Defaults to false: the layer does
		// not silently discard data. Callers that want a sliding window
		// opt in explicitly, either here or via setWindowSize().
		this.trimTail = o.trimTail !== undefined ? o.trimTail : false;

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

	getVisibleDomain(xDomain) {
		const [xMin, xMax] = xDomain;
		let min = Infinity;
		let max = -Infinity;

		for (let i = 0, len = this.data.length; i < len; i++) {
			const point = this.data[i];
			const x = this.xAccessor(point);
			if (!isFinite(x) || x < xMin || x > xMax) continue;
			const y = this.yAccessor(point);
			if (!isFinite(y)) continue;
			if (y < min) min = y;
			if (y > max) max = y;
		}

		if (min === Infinity) return { min: 0, max: 1, hasData: false };
		return { min, max, hasData: true };
	}

	// ──────────────────────────────────────────────────────────
	// POINT LIFECYCLE (contract)
	//
	// Concrete layers override appendPoint / updateLastPoint and the
	// hooks below. The base implementations here are deliberately thin:
	// they exist so subclasses and the plane can rely on the methods
	// being present, and so a layer that only inherits (no override)
	// still behaves sensibly.
	//
	// Contract:
	//   appendPoint(point)     — new row. Push, update stats, mark
	//                            dirty, fire POINT_ADDED.
	//   updateLastPoint(point) — replace the open row in place. Only
	//                            fires LAST_POINT_UPDATED. Delegates
	//                            to appendPoint when data is empty.
	// ──────────────────────────────────────────────────────────

	appendPoint(point) {
		this.data.push(point);
		this._stats.pointCount = this.data.length;
		this._stats.hasData = true;
		this._stats.lastX = this.xAccessor(point);
		this._stats.lastY = this.yAccessor(point);
		this._stats.xMin = Math.min(this._stats.xMin, this._stats.lastX);
		this._stats.xMax = Math.max(this._stats.xMax, this._stats.lastX);
		this._stats.yMin = Math.min(this._stats.yMin, this._stats.lastY);
		this._stats.yMax = Math.max(this._stats.yMax, this._stats.lastY);
		this._onDataChanged();
		this._emitPointAdded(point);
		return this;
	}

	updateLastPoint(point) {
		if (this.data.length === 0) return this.appendPoint(point);

		this.data[this.data.length - 1] = point;

		this._stats.lastX = this.xAccessor(point);
		this._stats.lastY = this.yAccessor(point);

		// Cheap incremental update. Subclasses with richer per-row
		// extents (OHLC, signed volume) override this method and
		// rescan when the replaced row sat at an extreme.
		if (this._stats.lastY < this._stats.yMin) this._stats.yMin = this._stats.lastY;
		if (this._stats.lastY > this._stats.yMax) this._stats.yMax = this._stats.lastY;

		this._onDataChanged();
		this._emitLastPointUpdated();
		return this;
	}

	/**
	 * Append or replace-last depending on whether `point` belongs
	 * to the same bucket as the current tail. keyFn maps a row to
	 * a comparable bucket key. Mirrors BaseIndicator.appendOrUpdate
	 * so callers can dispatch uniformly across layers and indicators.
	 */
	appendOrUpdate(point, keyFn) {
		const data = this.data;
		const last = data.length > 0 ? data[data.length - 1] : null;
		if (last && keyFn(last) === keyFn(point)) {
			this.updateLastPoint(point);
		} else {
			this.appendPoint(point);
		}
		return this;
	}

	/**
	 * Called after data mutates. Marks caches dirty, updates the plane,
	 * notifies on stats change. Subclasses may override but should call
	 * super.
	 */
	_onDataChanged() {
		const plane = this.plane;
		this.update();
		if (plane && plane.update) plane.update();
		if (plane && plane._onLayerStatsChanged) {
			plane._onLayerStatsChanged(this);
		}
	}

	_emitPointAdded(point) {
		const plane = this.plane;
		if (!plane || !plane.events) return;
		try {
			plane.events.emit(Events.POINT_ADDED, { point, layer: this });
			plane.events.emit(Events.LAST_POINT_UPDATED, {
				layer: this, stats: this.getStats(),
				lastPoint: { x: this._stats.lastX, y: this._stats.lastY }
			});
		} catch (e) { /* ignore */ }
	}

	_emitLastPointUpdated() {
		const plane = this.plane;
		if (!plane || !plane.events) return;
		try {
			plane.events.emit(Events.LAST_POINT_UPDATED, {
				layer: this, stats: this.getStats(),
				lastPoint: { x: this._stats.lastX, y: this._stats.lastY }
			});
		} catch (e) { /* ignore */ }
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