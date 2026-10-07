// ──────────────────────────────────────────────────────────────
// CandleStick.js
// ──────────────────────────────────────────────────────────────

import { SVG } from '../core/SVG.js';
import { CSS } from '../core/CSS.js';
import { ChartLayer } from '../core/ChartLayer.js';
import { Events } from '../core/Events.js';
import { Utils } from '../core/Utils.js';

const css = CSS.candleStick;

const DEFAULT_CANDLE_WIDTH_FACTOR = 0.7;
const DEFAULT_MIN_CANDLE_WIDTH = 1;

export class CandleStick extends ChartLayer {
	constructor(options = {}) {
		super({
			id: options.id,
			type: 'candle',
			name: options.name || 'CandleStick',
			label: options.label || options.name || 'CandleStick',
			plane: options.plane,
			onUpdate: options.onUpdate,
			onDestroy: options.onDestroy,
			data: options.data,
			xAccessor: options.xAccessor,
			yAccessor: options.closeAccessor || options.yAccessor,
			decimals: options.decimals
		});

		// OHLC accessors
		this.xAccessor = options.xAccessor || (d => d.time !== undefined ? d.time : d.x);
		this.openAccessor = options.openAccessor || (d => d.open !== undefined ? d.open : d.o);
		this.highAccessor = options.highAccessor || (d => d.high !== undefined ? d.high : d.h);
		this.lowAccessor = options.lowAccessor || (d => d.low !== undefined ? d.low : d.l);
		this.closeAccessor = options.closeAccessor || (d => d.close !== undefined ? d.close : d.c);
		this.yAccessor = this.closeAccessor;

		// Display
		this.candleWidthFactor = options.candleWidthFactor !== undefined
			? options.candleWidthFactor
			: DEFAULT_CANDLE_WIDTH_FACTOR;
		this.minCandleWidth = options.minCandleWidth !== undefined
			? options.minCandleWidth
			: DEFAULT_MIN_CANDLE_WIDTH;

		// Clipping
		this.clipArea = options.clipArea;

		// Scales
		this.yScale = options.yScale || null;
		this.xScale = options.xScale || null;

		// DOM
		this._elements = {
			outer: null,          // unclipped wrapper
			group: null,
			ghostPath: null,
			wickPath: null,
			upBodyPath: null,
			downBodyPath: null
		};

		// State
		this._contentCreated = false;
		this._dataDirty = true;
		this._scaleDirty = true;
		this._plotDirty = true;

		// Caches
		this._dWicks = null;
		this._dUp = null;
		this._dDown = null;
		this._dGhost = null;
		this._renderKey = null;

		// Reusable string builders
		this._wickParts = [];
		this._upParts = [];
		this._downParts = [];
		this._ghostParts = [];

		if (this.data.length > 0) this._recalcStats(this.data);
	}

	// ─── Render ───
	render(container) {
		if (!this.plane) throw new Error('CandleStick: plane not set.');

		if (!this._contentCreated) {
			this._createContent(container);
			this._contentCreated = true;
		} else if (this._elements.outer && !this._elements.outer.parentNode) {
			SVG.append(container, this._elements.outer);
		}

		this._renderData();
		return this._elements.outer;
	}

	_createContent(container) {
		// Outer, unclipped wrapper. Renders into the band slot; the
		// ghost lives here so it can extend beyond the clip rect.
		const outer = SVG.create('g', {
			id: `${this.id}-outer`,
			class: css.outer || 'candle-group-outer'
		});
		SVG.append(container, outer);
		this._elements.outer = outer;

		// Ghost sits behind the candles, unclipped.
		const ghostClass = `${css.path || 'candle-path'} ${css.pathGhost || 'candle-path-ghost'}`;
		this._elements.ghostPath = SVG.create('polyline', {
			id: `${this.id}-ghost`,
			class: ghostClass,
			visibility: 'hidden'
		});
		SVG.append(outer, this._elements.ghostPath);

		// Inner, clipped group. Wicks and bodies live here.
		const g = SVG.create('g', {
			id: `${this.id}-group`,
			class: css.group
		});
		SVG.append(outer, g);
		this._elements.group = g;

		this._elements.wickPath = SVG.create('path', {
			id: `${this.id}-wicks`,
			class: css.wicks
		});
		SVG.append(g, this._elements.wickPath);

		this._elements.upBodyPath = SVG.create('path', {
			id: `${this.id}-up`,
			class: css.upBody
		});
		SVG.append(g, this._elements.upBodyPath);

		this._elements.downBodyPath = SVG.create('path', {
			id: `${this.id}-down`,
			class: css.downBody
		});
		SVG.append(g, this._elements.downBodyPath);
	}

	// ─── Data rendering ───
	_renderData() {
		const data = this.data;
		const len = data.length;

		if (len === 0) {
			this._writePaths('', '', '');
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

		const width = this._computeCandlePixelWidth(xScale, data);
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

		const oAcc = this.openAccessor;
		const hAcc = this.highAccessor;
		const lAcc = this.lowAccessor;
		const cAcc = this.closeAccessor;

		const wickParts = this._wickParts;
		const upParts = this._upParts;
		const downParts = this._downParts;
		const ghostParts = this._ghostParts;
		wickParts.length = 0;
		upParts.length = 0;
		downParts.length = 0;
		ghostParts.length = 0;

		for (let i = 0; i < len; i++) {
			const d = data[i];
			const xData = xAcc(d);

			if (!isFinite(xData)) continue;

			const xPix = xScale.toScreen(xData);
			if (!isFinite(xPix)) continue;

			// Candle geometry — filtered to the padded visible range.
			if (xData < dMin || xData > dMax) continue;

			const o = oAcc(d);
			const h = hAcc(d);
			const l = lAcc(d);
			const c = cAcc(d);

			if (!isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) continue;

			const yHigh = yScale.toScreen(h);
			const yLow = yScale.toScreen(l);
			const yOpen = yScale.toScreen(o);
			const yClose = yScale.toScreen(c);

			if (!isFinite(yHigh) || !isFinite(yLow) ||
				!isFinite(yOpen) || !isFinite(yClose)) continue;

			// Wick
			wickParts.push('M', xPix, ',', yHigh, 'L', xPix, ',', yLow);

			// Body
			const bodyTop = yOpen < yClose ? yOpen : yClose;
			const bodyBottom = yOpen < yClose ? yClose : yOpen;
			let bodyHeight = bodyBottom - bodyTop;
			if (bodyHeight < 1) bodyHeight = 1;

			const x1 = xPix - halfW;
			const x2 = xPix + halfW;
			const yBottom = bodyTop + bodyHeight;

			const target = c >= o ? upParts : downParts;
			target.push(
				'M', x1, ',', bodyTop,
				'L', x2, ',', bodyTop,
				'L', x2, ',', yBottom,
				'L', x1, ',', yBottom,
				'Z'
			);
		}

		this._writePaths(
			wickParts.join(''),
			upParts.join(''),
			downParts.join('')
		);

		this._applyClips(plane);
	}

	_writePaths(wicks, up, down) {
		const el = this._elements;

		if (wicks !== this._dWicks && el.wickPath) {
			el.wickPath.setAttribute('d', wicks);
			this._dWicks = wicks;
		}
		if (up !== this._dUp && el.upBodyPath) {
			el.upBodyPath.setAttribute('d', up);
			this._dUp = up;
		}
		if (down !== this._dDown && el.downBodyPath) {
			el.downBodyPath.setAttribute('d', down);
			this._dDown = down;
		}
	}

	_computeCandlePixelWidth(xScale, data) {
		const len = data.length;
		if (len === 0) return this.minCandleWidth;
		if (len === 1) {
			const w = Math.max(this.minCandleWidth, this.plane.plotWidth * 0.02);
			return w;
		}

		const pixelGap = Utils.sampledIntervalPixelWidth(data, this.xAccessor, xScale);
		if (pixelGap === null) return this.minCandleWidth;

		const w = pixelGap * this.candleWidthFactor;
		return w > this.minCandleWidth ? w : this.minCandleWidth;
	}

	// ─── Crosshair support ───
	getSnapPoints(datum) {
		const o = this.openAccessor(datum);
		const h = this.highAccessor(datum);
		const l = this.lowAccessor(datum);
		const c = this.closeAccessor(datum);

		const pts = [];
		if (isFinite(h)) pts.push({ y: h, kind: 'high' });
		if (isFinite(l)) pts.push({ y: l, kind: 'low' });
		if (isFinite(o)) pts.push({ y: o, kind: 'open' });
		if (isFinite(c)) pts.push({ y: c, kind: 'close' });
		return pts;
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
		const hAcc = this.highAccessor;
		const lAcc = this.lowAccessor;
		const cAcc = this.closeAccessor;

		let xMin = Infinity, xMax = -Infinity;
		let yMin = Infinity, yMax = -Infinity;

		for (let i = 0, len = data.length; i < len; i++) {
			const d = data[i];
			const x = xAcc(d);
			const h = hAcc(d);
			const l = lAcc(d);

			if (isFinite(x)) {
				if (x < xMin) xMin = x;
				if (x > xMax) xMax = x;
			}
			if (isFinite(h) && h > yMax) yMax = h;
			if (isFinite(l) && l < yMin) yMin = l;
		}

		const last = data[data.length - 1];
		this._stats = {
			xMin, xMax,
			yMin, yMax,
			lastX: xAcc(last),
			lastY: cAcc(last),
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
		const c = this.closeAccessor(point);
		const h = this.highAccessor(point);
		const l = this.lowAccessor(point);

		this.data.push(point);

		const s = this._stats;
		const prevYMin = s.yMin;
		const prevYMax = s.yMax;
		const prevXMin = s.xMin;
		const prevXMax = s.xMax;
		const prevHasData = s.hasData;

		s.pointCount++;
		s.lastX = x;
		s.lastY = c;
		s.hasData = true;
		if (isFinite(h) && h > s.yMax) s.yMax = h;
		if (isFinite(l) && l < s.yMin) s.yMin = l;
		if (isFinite(x)) {
			if (x < s.xMin) s.xMin = x;
			if (x > s.xMax) s.xMax = x;
		}

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
		const hAcc = this.highAccessor;
		const lAcc = this.lowAccessor;
		const len = data.length;

		let firstKeep = 0;
		while (firstKeep < len && xAcc(data[firstKeep]) < cutoff) firstKeep++;
		if (firstKeep === 0) return;

		let removedMin = Infinity;
		let removedMax = -Infinity;
		for (let i = 0; i < firstKeep; i++) {
			const h = hAcc(data[i]);
			const l = lAcc(data[i]);
			if (isFinite(l) && l < removedMin) removedMin = l;
			if (isFinite(h) && h > removedMax) removedMax = h;
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
		this._dWicks = null;
		this._dUp = null;
		this._dDown = null;
		this._dGhost = null;
		this.update();
		return this;
	}

	// ─── Lifecycle ───
	destroy() {
		super.destroy();
		const outer = this._elements.outer;
		if (outer && outer.parentNode) outer.parentNode.removeChild(outer);
		this._elements = {
			outer: null,
			group: null,
			ghostPath: null,
			wickPath: null,
			upBodyPath: null,
			downBodyPath: null
		};
		this._contentCreated = false;
		this.data = [];
		this._dWicks = null;
		this._dUp = null;
		this._dDown = null;
		this._dGhost = null;
		this._renderKey = null;
		this._wickParts = [];
		this._upParts = [];
		this._downParts = [];
		this._ghostParts = [];
	}
}

export default CandleStick;