// ──────────────────────────────────────────────────────────────
// Line.js
// ──────────────────────────────────────────────────────────────

import { SVG } from '../core/SVG.js';
import { CSS } from '../core/CSS.js';
import { ChartLayer } from '../core/ChartLayer.js';
import { Events } from '../core/Events.js';
import { Utils } from '../core/Utils.js';

const css = CSS.line;

const MAX_POINTS_TO_RENDER = 2000;
const DOWNSAMPLE_THRESHOLD = 1000;

export class Line extends ChartLayer {
	constructor(options = {}) {
		super({
			id: options.id,
			type: 'line',
			name: options.name || 'Line',
			label: options.label || options.name || 'Line',
			plane: options.plane,
			onUpdate: options.onUpdate,
			onDestroy: options.onDestroy,
			data: options.data,
			xAccessor: options.xAccessor,
			yAccessor: options.yAccessor,
			decimals: options.decimals
		});

		// Behavior
		this.maxPoints = options.maxPoints || 5000;
		this.trimTail = options.trimTail !== undefined ? options.trimTail : true;
		this.downsample = options.downsample !== undefined ? options.downsample : true;

		// Clipping
		this.clipArea = options.clipArea;

		// Scales
		this.yScale = options.yScale || null;
		this.xScale = options.xScale || null;

		// DOM
		this._elements = {
			group: null,
			path: null
		};

		// State
		this._contentCreated = false;
		this._dataDirty = true;
		this._scaleDirty = true;
		this._plotDirty = true;

		// Caches
		this._cachedPath = null;
		this._renderKey = null;

		// Scratch
		this._pathParts = [];

		if (this.data.length > 0) this._recalcStats(this.data);
	}

	// ─── Render ───
	render(container) {
		if (!this.plane) throw new Error('Line: plane not set.');

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

		this._elements.path = SVG.create('polyline', {
			id: `${this.id}-path`,
			class: css.path
		});
		SVG.append(g, this._elements.path);
	}

	// ─── Data rendering ───
	_renderData() {
		const data = this.data;
		const len = data.length;

		if (len === 0) {
			if (this._elements.path) this._elements.path.setAttribute('points', '');
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

		const renderData = (this.downsample && len > DOWNSAMPLE_THRESHOLD)
			? Utils.downsample(data, MAX_POINTS_TO_RENDER)
			: data;

		const parts = this._pathParts;
		parts.length = 0;

		const xAcc = this.xAccessor;
		const yAcc = this.yAccessor;
		const rlen = renderData.length;

		for (let i = 0; i < rlen; i++) {
			const d = renderData[i];
			const px = xScale.toScreen(xAcc(d));
			const py = yScale.toScreen(yAcc(d));
			if (!isFinite(px) || !isFinite(py)) continue; //TEMP
			parts.push(px, ',', py, ' ');
		}

		if (parts.length > 0) parts.length -= 1;
		const path = parts.join('');

		if (path !== this._cachedPath) {
			this._elements.path.setAttribute('points', path);
			this._cachedPath = path;
		}

		this._applyClips(plane);
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

		const stats = Utils.findExtremes(data, this.xAccessor, this.yAccessor);

		if (!stats.hasData) {
			this._stats = {
				xMin: Infinity, xMax: -Infinity,
				yMin: Infinity, yMax: -Infinity,
				lastX: null, lastY: null,
				pointCount: 0, hasData: false
			};
		} else {
			const lastPoint = data[data.length - 1];
			this._stats = {
				xMin: stats.xMin, xMax: stats.xMax,
				yMin: stats.yMin, yMax: stats.yMax,
				lastX: this.xAccessor(lastPoint),
				lastY: this.yAccessor(lastPoint),
				pointCount: data.length,
				hasData: true
			};
		}

		const s = this._stats;
		return (
			prevYMin !== s.yMin ||
			prevYMax !== s.yMax ||
			prevXMin !== s.xMin ||
			prevXMax !== s.xMax ||
			prevHasData !== s.hasData
		);
	}

	getColor() {
		const group = this._elements && this._elements.group;
		if (group) {
			const v = getComputedStyle(group).getPropertyValue('--line-color').trim();
			if (v) return v;
		}
		return this.color || null;
	}

	// ─── Data management ───
	setData(data) {
		this.data = data;
		const changed = this._recalcStats(data);
		this._cachedPath = null;
		this._renderKey = null;
		this._dataDirty = true;
		this.update();

		if (changed && this.plane && this.plane._onLayerStatsChanged) {
			this.plane._onLayerStatsChanged(this);
		}
		return this;
	}

	setWindowSize(windowSize) {
		this._windowSize = windowSize;

		if (this.trimTail && this.data.length > 0) {
			const lastX = this.xAccessor(this.data[this.data.length - 1]);
			const cutoff = lastX - windowSize;

			const xAcc = this.xAccessor;
			const yAcc = this.yAccessor;
			let firstKeep = 0;
			while (firstKeep < this.data.length && xAcc(this.data[firstKeep]) < cutoff) {
				firstKeep++;
			}

			if (firstKeep > 0) {
				let removedMin = Infinity;
				let removedMax = -Infinity;
				for (let i = 0; i < firstKeep; i++) {
					const y = yAcc(this.data[i]);
					if (y < removedMin) removedMin = y;
					if (y > removedMax) removedMax = y;
				}

				const s = this._stats;
				const needRescan = (removedMin <= s.yMin) || (removedMax >= s.yMax);

				this.data = this.data.slice(firstKeep);

				if (needRescan) {
					this._recalcStats(this.data);
				} else {
					s.pointCount = this.data.length;
				}

				this._cachedPath = null;
				this._dataDirty = true;
			}
		}

		if (this.plane && this.plane._onLayerStatsChanged) {
			this.plane._onLayerStatsChanged(this);
		}
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
		if (this.trimTail && plane && plane.windowSize) {
			const cutoff = x - plane.windowSize;
			this._trimTail(cutoff);
		} else if (this.trimTail && this.maxPoints && this.maxPoints !== Infinity && this.data.length > this.maxPoints) {
			this.data = Utils.limitPoints(this.data, this.maxPoints);
			this._recalcStats(this.data);
		}

		const changed =
			prevYMin !== s.yMin ||
			prevYMax !== s.yMax ||
			prevXMin !== s.xMin ||
			prevXMax !== s.xMax ||
			prevHasData !== s.hasData;

		this._cachedPath = null;
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
		this._cachedPath = null;
		this._renderKey = null;
		this.update();
		return this;
	}

	// ─── Lifecycle ───
	destroy() {
		super.destroy();
		if (this._elements.group && this._elements.group.parentNode) {
			this._elements.group.parentNode.removeChild(this._elements.group);
		}
		this._elements = { group: null, path: null };
		this._contentCreated = false;
		this.data = [];
		this._cachedPath = null;
		this._renderKey = null;
		this._pathParts = [];
	}
}

export default Line;