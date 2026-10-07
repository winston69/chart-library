// ──────────────────────────────────────────────────────────────
// BarChart.js
// ──────────────────────────────────────────────────────────────

import { SVG } from '../core/SVG.js';
import { CSS } from '../core/CSS.js';
import { ChartLayer } from '../core/ChartLayer.js';
import { Events } from '../core/Events.js';

const css = CSS.barChart;

const DEFAULT_BAR_WIDTH_FACTOR = 1;
const DEFAULT_MIN_BAR_WIDTH = 1;

export class BarChart extends ChartLayer {
	constructor(options = {}) {
		super({
			id: options.id,
			type: 'bar',
			name: options.name || 'BarChart',
			label: options.label || options.name || 'BarChart',
			plane: options.plane,
			onUpdate: options.onUpdate,
			onDestroy: options.onDestroy,
			data: options.data,
			xAccessor: options.xAccessor,
			yAccessor: options.yAccessor,
			decimals: options.decimals
		});

		// Bar width
		this.barWidthFactor = options.barWidthFactor !== undefined
			? options.barWidthFactor
			: DEFAULT_BAR_WIDTH_FACTOR;
		this.minBarWidth = options.minBarWidth !== undefined
			? options.minBarWidth
			: DEFAULT_MIN_BAR_WIDTH;

		// Baseline
		this.baseline = options.baseline || 'zero';

		// Direction
		// If directionAccessor is omitted, the bar chart looks for
		// open/close accessors and compares them. If neither exists,
		// every bar is treated as 'up' and only the up path renders.
		this.directionAccessor = options.directionAccessor || null;
		this.openAccessor = options.openAccessor || null;
		this.closeAccessor = options.closeAccessor || null;

		this.directionMode = options.directionMode || 'ohlc';

		// Clipping
		this.clipArea = options.clipArea;

		// Scales
		this.yScale = options.yScale || null;
		this.xScale = options.xScale || null;

		// DOM
		this._elements = {
			group: null,
			barUpPath: null,
			barDownPath: null
		};

		// State
		this._contentCreated = false;
		this._dataDirty = true;
		this._scaleDirty = true;
		this._plotDirty = true;

		// Caches
		this._dUp = null;
		this._dDown = null;
		this._renderKey = null;

		// Scratch
		this._upParts = [];
		this._downParts = [];

		if (this.data.length > 0) this._recalcStats(this.data);
	}

	// ─── Render ───
	render(container) {
		if (!this.plane) throw new Error('BarChart: plane not set.');

		if (!this._contentCreated) {
			this._createContent(container);
			this._contentCreated = true;
		} else if (this._elements.group && !this._elements.group.parentNode) {
			SVG.append(container, this._elements.group);
		}

		this._renderData();
		return this._elements.group;
	}

	_createContent(container) {
		const g = SVG.create('g', {
			id: `${this.id}-group`,
			class: css.group
		});
		SVG.append(container, g);
		this._elements.group = g;

		// Down path first so it sits behind up bars on overlap. In
		// practice bars don't overlap, but z-order is free to set.
		this._elements.barDownPath = SVG.create('path', {
			id: `${this.id}-down`,
			class: css.barDown
		});
		SVG.append(g, this._elements.barDownPath);

		this._elements.barUpPath = SVG.create('path', {
			id: `${this.id}-up`,
			class: css.barUp
		});
		SVG.append(g, this._elements.barUpPath);
	}

	// ─── Direction ───
	_isUp(datum) {
		if (this.directionMode === 'sign') {
			const v = this.yAccessor(datum);
			return isFinite(v) && v >= 0;
		}
		if (this.directionAccessor) {
			const v = this.directionAccessor(datum);
			if (typeof v === 'string') return v === 'up';
			if (typeof v === 'boolean') return v;
			if (typeof v === 'number') return v >= 0;
		}
		if (this.openAccessor && this.closeAccessor) {
			const o = this.openAccessor(datum);
			const c = this.closeAccessor(datum);
			if (isFinite(o) && isFinite(c)) return c >= o;
		}
		return true;
	}

	// ─── Data rendering ───
	_renderData() {
		const data = this.data;
		const len = data.length;

		if (len === 0) {
			this._writePaths('', '');
			return;
		}

		const plane = this.plane;
		const xScale = this.xScale || plane.xScale;
		const yScale = this.yScale || plane.yScale;
		if (!yScale || !xScale) return;

		const xD = xScale.domain, xR = xScale.range;
		const yD = yScale.domain, yR = yScale.range;
		const key =
			xD[0] + ',' + xD[1] + '|' + xR[0] + ',' + xR[1] + '|' +
			yD[0] + ',' + yD[1] + '|' + yR[0] + ',' + yR[1];

		if (key === this._renderKey && !this._dataDirty) return;
		this._renderKey = key;

		const width = this._computeBarPixelWidth(xScale, data);
		const halfW = width / 2;

		const xAcc = this.xAccessor;
		let padData = 0;
		if (len > 1) {
			const firstX = xAcc(data[0]);
			const secondX = xAcc(data[1]);
			padData = secondX > firstX ? secondX - firstX : firstX - secondX;
		}
		const dMin = xD[0] - padData;
		const dMax = xD[1] + padData;

		// Baseline pixel
		let baseY;
		if (this.baseline === 'dataMin') {
			baseY = yScale.toScreen(this._stats.yMin);
		} else if (this.baseline === 'bandBottom') {
			const bb = plane.getBandBounds ? plane.getBandBounds(this) : null;
			baseY = bb ? bb.bottom : plane.plotBottom;
		} else {
			baseY = yScale.toScreen(0);
		}

		const upParts = this._upParts;
		const downParts = this._downParts;
		upParts.length = 0;
		downParts.length = 0;

		const yAcc = this.yAccessor;

		for (let i = 0; i < len; i++) {
			const d = data[i];
			const xData = xAcc(d);
			if (!isFinite(xData) || xData < dMin || xData > dMax) continue;

			const yv = yAcc(d);
			if (!isFinite(yv)) continue;

			const xPix = xScale.toScreen(xData);
			if (!isFinite(xPix)) continue;

			const yPix = yScale.toScreen(yv);
			if (!isFinite(yPix)) continue;

			const x1 = xPix - halfW;
			const x2 = xPix + halfW;
			const top = Math.min(yPix, baseY);
			const bottom = Math.max(yPix, baseY);
			let h = bottom - top;
			if (h < 0.5) h = 0.5;

			const target = this._isUp(d) ? upParts : downParts;
			target.push(
				'M', x1, ',', top,
				'L', x2, ',', top,
				'L', x2, ',', top + h,
				'L', x1, ',', top + h,
				'Z'
			);
		}

		this._writePaths(upParts.join(''), downParts.join(''));
		this._applyClips(plane);
	}

	_writePaths(up, down) {
		const el = this._elements;

		if (up !== this._dUp && el.barUpPath) {
			el.barUpPath.setAttribute('d', up);
			this._dUp = up;
		}
		if (down !== this._dDown && el.barDownPath) {
			el.barDownPath.setAttribute('d', down);
			this._dDown = down;
		}
	}

	_computeBarPixelWidth(xScale, data) {
		const len = data.length;
		if (len === 0) return this.minBarWidth;

		if (len === 1) {
			const w = Math.max(this.minBarWidth, this.plane.plotWidth * 0.02);
			return w;
		}

		const xAcc = this.xAccessor;
		const sampleCount = len - 1 < 100 ? len - 1 : 100;
		let minGap = Infinity;

		for (let i = 0; i < sampleCount; i++) {
			const xa = xAcc(data[i]);
			const xb = xAcc(data[i + 1]);
			if (!isFinite(xa) || !isFinite(xb)) continue;
			const gap = xb > xa ? xb - xa : xa - xb;
			if (gap > 0 && gap < minGap) minGap = gap;
		}

		if (!isFinite(minGap) || minGap <= 0) return this.minBarWidth;

		const x0 = xScale.toScreen(0);
		const x1 = xScale.toScreen(minGap);
		const pixelGap = x1 > x0 ? x1 - x0 : x0 - x1;

		const w = pixelGap * this.barWidthFactor;
		return w > this.minBarWidth ? w : this.minBarWidth;
	}

	// ─── Clipping ───
	_getEffectiveClip(plane) {
		const planeClip = plane.clipArea || { line: true };

		if (this.clipArea === undefined || this.clipArea === null) {
			return { line: planeClip.line };
		}
		if (this.clipArea === true) return { line: true };
		if (this.clipArea === false) return { line: false };

		return {
			line: this.clipArea.line !== undefined ? this.clipArea.line : planeClip.line
		};
	}

	_applyClips(plane) {
		const clip = this._getEffectiveClip(plane);

		let clipUrl = null;
		if (this._yGroupId && plane.getClipPathId) {
			const clipId = plane.getClipPathId(this._yGroupId);
			if (clipId) clipUrl = `url(#${clipId})`;
		}

		const desired = (clip.line && clipUrl) ? clipUrl : null;
		const group = this._elements.group;
		if (!group) return;

		const current = group.getAttribute('clip-path');
		if (current === desired) return;
		if (desired) group.setAttribute('clip-path', desired);
		else group.removeAttribute('clip-path');
	}

	// ─── Stats ───
	_recalcStats(data) {
		const prev = this._stats;
		const prevYMin = prev.yMin;
		const prevYMax = prev.yMax;
		const prevXMin = prev.xMin;
		const prevXMax = prev.xMax;
		const prevHasData = prev.hasData;

		if (!data || data.length === 0) {
			this._stats = {
				xMin: Infinity, xMax: -Infinity,
				yMin: Infinity, yMax: -Infinity,
				lastX: null, lastY: null,
				pointCount: 0, hasData: false
			};
			return true;
		}

		const xAcc = this.xAccessor;
		const yAcc = this.yAccessor;

		let xMin = Infinity, xMax = -Infinity;
		let yMin = Infinity, yMax = -Infinity;

		for (let i = 0, len = data.length; i < len; i++) {
			const d = data[i];
			const x = xAcc(d);
			const y = yAcc(d);

			if (isFinite(x)) {
				if (x < xMin) xMin = x;
				if (x > xMax) xMax = x;
			}
			if (isFinite(y)) {
				if (y < yMin) yMin = y;
				if (y > yMax) yMax = y;
			}
		}

		if (this.baseline === 'zero' && yMin > 0) yMin = 0;

		const last = data[data.length - 1];
		this._stats = {
			xMin, xMax,
			yMin, yMax,
			lastX: xAcc(last),
			lastY: yAcc(last),
			pointCount: data.length,
			hasData: true
		};

		const s = this._stats;
		return (
			prevYMin !== s.yMin ||
			prevYMax !== s.yMax ||
			prevXMin !== s.xMin ||
			prevXMax !== s.xMax ||
			prevHasData !== s.hasData
		);
	}

	// ─── Data management ───
	setData(data) {
		this.data = data;
		const changed = this._recalcStats(data);
		this._dataDirty = true;
		this._renderKey = null;
		this.update();

		if (changed && this.plane && this.plane._onLayerStatsChanged) {
			this.plane._onLayerStatsChanged(this);
		}
		return this;
	}

	appendPoint(point) {
		const x = this.xAccessor(point);
		const y = this.yAccessor(point);

		this.data.push(point);

		const s = this._stats;
		const prevYMin = s.yMin;
		const prevYMax = s.yMax;
		const prevXMin = s.xMin;
		const prevXMax = s.xMax;
		const prevHasData = s.hasData;

		s.pointCount++;
		s.lastX = x;
		s.lastY = y;
		s.hasData = true;
		if (y < s.yMin) s.yMin = y;
		if (y > s.yMax) s.yMax = y;
		if (x < s.xMin) s.xMin = x;
		if (x > s.xMax) s.xMax = x;

		const plane = this.plane;
		if (plane && plane.windowSize) {
			const cutoff = x - plane.windowSize;
			this._trimTail(cutoff);
		}

		const changed =
			prevYMin !== s.yMin ||
			prevYMax !== s.yMax ||
			prevXMin !== s.xMin ||
			prevXMax !== s.xMax ||
			prevHasData !== s.hasData;

		this._dataDirty = true;
		this.update();

		if (changed && plane && plane._onLayerStatsChanged) {
			plane._onLayerStatsChanged(this);
		}
		if (plane && plane.update) plane.update();

		try {
			if (plane && plane.events) {
				plane.events.emit(Events.POINT_ADDED, { point, layer: this });
				plane.events.emit(Events.LAST_POINT_UPDATED, {
					layer: this, stats: this.getStats(),
					lastPoint: { x: s.lastX, y: s.lastY }
				});
			}
		} catch (e) { /* ignore */ }

		return this;
	}

	_trimTail(cutoff) {
		const data = this.data;
		const xAcc = this.xAccessor;
		const yAcc = this.yAccessor;
		const len = data.length;

		let firstKeep = 0;
		while (firstKeep < len && xAcc(data[firstKeep]) < cutoff) firstKeep++;
		if (firstKeep === 0) return;

		let removedMin = Infinity;
		let removedMax = -Infinity;
		for (let i = 0; i < firstKeep; i++) {
			const y = yAcc(data[i]);
			if (y < removedMin) removedMin = y;
			if (y > removedMax) removedMax = y;
		}

		const s = this._stats;
		const needRescan = (removedMin <= s.yMin) || (removedMax >= s.yMax);

		this.data = data.slice(firstKeep);

		if (needRescan) {
			this._recalcStats(this.data);
		} else {
			s.pointCount = this.data.length;
		}
		this._dataDirty = true;
	}

	setWindowSize(windowSize) {
		this._windowSize = windowSize;

		if (this.data.length > 0) {
			const lastX = this.xAccessor(this.data[this.data.length - 1]);
			const cutoff = lastX - windowSize;
			this._trimTail(cutoff);
		}

		if (this.plane && this.plane._onLayerStatsChanged) {
			this.plane._onLayerStatsChanged(this);
		}
	}

	// ─── Update ───
	update() {
		if (!this._contentCreated) {
			if (this.plane) this.render(this.plane._elements.rootGroup);
			return this;
		}

		if (this._dataDirty || this._scaleDirty || this._plotDirty) {
			this._renderData();
			this._dataDirty = false;
			this._scaleDirty = false;
			this._plotDirty = false;
			this._updateCount++;

			if (this.plane && this.plane.events) {
				this.plane.events.emit(Events.LAYER_UPDATED, {
					layer: this, id: this.id, stats: this.getStats()
				});
			}
			if (this.onUpdate) this.onUpdate(this);
		} else {
			this._updateCount++;
		}
		return this;
	}

	forceUpdate() {
		this._dataDirty = true;
		this._scaleDirty = true;
		this._plotDirty = true;
		this._renderKey = null;
		this._dUp = null;
		this._dDown = null;
		this.update();
		return this;
	}

	// ─── Lifecycle ───
	destroy() {
		super.destroy();
		const group = this._elements.group;
		if (group && group.parentNode) group.parentNode.removeChild(group);
		this._elements = { group: null, barUpPath: null, barDownPath: null };
		this._contentCreated = false;
		this.data = [];
		this._dUp = null;
		this._dDown = null;
		this._renderKey = null;
		this._upParts = [];
		this._downParts = [];
	}
}

export default BarChart;