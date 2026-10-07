// ──────────────────────────────────────────────────────────────
// Area.js
//
// Fills the region under a source layer's line, down to a baseline.
// Contributes nothing to the domain.
// ──────────────────────────────────────────────────────────────

import { SVG } from '../core/SVG.js';
import { CSS } from '../core/CSS.js';
import { ChartLayer } from '../core/ChartLayer.js';

const css = CSS.area;

export class Area extends ChartLayer {
	constructor(options = {}) {
		super({
			id: options.id,
			type: 'area',
			name: options.name || 'Area',
			label: options.label || options.name || 'Area',
			plane: options.plane,
			onUpdate: options.onUpdate,
			onDestroy: options.onDestroy,
			data: options.data,
			xAccessor: options.xAccessor,
			yAccessor: options.yAccessor
		});

		this.sourceLayer = options.sourceLayer || null;

		// 'dataMin' | 'bandBottom' | number
		this.baseline = options.baseline !== undefined ? options.baseline : 'dataMin';

		// Clipped by default
		this.clipArea = options.clipArea !== undefined ? options.clipArea : true;

		this.xScale = options.xScale || null;
		this.yScale = options.yScale || null;

		this._elements = {
			group: null,
			polygon: null
		};

		this._contentCreated = false;
		this._dataDirty = true;
		this._scaleDirty = true;
		this._plotDirty = true;

		this._cachedPoints = null;
		this._renderKey = null;
		this._pathParts = [];

		if (!this.sourceLayer && this.data.length > 0) {
			this._recalcStats(this.data);
		}
	}

	// ─── Render ───
	render(container) {
		if (!this.plane) throw new Error('Area: plane not set.');

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

		this._elements.polygon = SVG.create('polygon', {
			id: `${this.id}-polygon`,
			class: css.area
		});
		SVG.append(g, this._elements.polygon);

		if (this._color) {
			g.style.setProperty('--area-color', this._color);
		}
		if (this._opacity !== undefined) {
			g.style.setProperty('--area-opacity', this._opacity);
		}
	}

	// ─── Source resolution ───
	_getData() {
		if (this.sourceLayer) {
			return this.sourceLayer.getData
				? this.sourceLayer.getData()
				: this.sourceLayer.data;
		}
		return this.data;
	}

	_getXAccessor() {
		if (this.sourceLayer && this.sourceLayer.xAccessor) return this.sourceLayer.xAccessor;
		return this.xAccessor;
	}

	_getYAccessor() {
		if (this.sourceLayer && this.sourceLayer.yAccessor) return this.sourceLayer.yAccessor;
		return this.yAccessor;
	}

	// ─── Data rendering ───
	_renderData() {
		const data = this._getData();
		const len = data ? data.length : 0;

		if (len === 0) {
			if (this._elements.polygon && this._cachedPoints !== '') {
				this._elements.polygon.setAttribute('points', '');
				this._cachedPoints = '';
			}
			return;
		}

		const plane = this.plane;
		const xScale = this.xScale || plane.xScale;
		const yScale = this.yScale
			|| plane.getYScaleForChart(this.sourceLayer || this);
		if (!yScale || !xScale) return;

		const xD = xScale.domain, xR = xScale.range;
		const yD = yScale.domain, yR = yScale.range;
		const key =
			xD[0] + ',' + xD[1] + '|' + xR[0] + ',' + xR[1] + '|' +
			yD[0] + ',' + yD[1] + '|' + yR[0] + ',' + yR[1] +
			'|' + this.baseline;

		if (key === this._renderKey && !this._dataDirty) return;
		this._renderKey = key;

		// Resolve baseline pixel
		let fillBottom;
		if (typeof this.baseline === 'number') {
			fillBottom = yScale.toScreen(this.baseline);
		} else if (this.baseline === 'dataMin') {
			const src = this.sourceLayer || this;
			const stats = src.getStats ? src.getStats() : this._stats;
			fillBottom = yScale.toScreen(stats.yMin);
		} else {
			// 'bandBottom'
			const bounds = plane.getBandBounds
				? plane.getBandBounds(this.sourceLayer || this)
				: null;
			fillBottom = bounds ? bounds.bottom : plane.plotBottom;
		}
		if (!isFinite(fillBottom)) fillBottom = plane.plotBottom;

		const xAcc = this._getXAccessor();
		const yAcc = this._getYAccessor();

		const parts = this._pathParts;
		parts.length = 0;

		let firstX = 0, lastX = 0;
		let wrote = false;

		for (let i = 0; i < len; i++) {
			const d = data[i];
			const px = xScale.toScreen(xAcc(d));
			const py = yScale.toScreen(yAcc(d));
			if (!isFinite(px) || !isFinite(py)) continue;
			if (!wrote) { firstX = px; wrote = true; }
			lastX = px;
			parts.push(px, ',', py, ' ');
		}

		if (!wrote) {
			if (this._cachedPoints !== '') {
				this._elements.polygon.setAttribute('points', '');
				this._cachedPoints = '';
			}
			return;
		}

		parts.length -= 1;

		const points = `${firstX},${fillBottom} ${parts.join('')} ${lastX},${fillBottom}`;

		if (points !== this._cachedPoints) {
			this._elements.polygon.setAttribute('points', points);
			this._cachedPoints = points;
		}

		this._applyClips(plane);
	}

	// ─── Clipping ───
	_getEffectiveClip(plane) {
		const planeClip = plane.clipArea || { area: true };

		if (this.clipArea === undefined || this.clipArea === null) {
			return { line: planeClip.area };
		}
		if (this.clipArea === true) return { line: true };
		if (this.clipArea === false) return { line: false };
		return {
			line: this.clipArea.line !== undefined ? this.clipArea.line : planeClip.area
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
	getStats() { return { hasData: false }; }
	getDomain() { return { hasData: false }; }
	_recalcStats() { /* annotation layer — no domain contribution */ }

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
		this._cachedPoints = null;
		this.update();
		return this;
	}

	// ─── Lifecycle ───
	destroy() {
		super.destroy();
		const group = this._elements.group;
		if (group && group.parentNode) group.parentNode.removeChild(group);
		this._elements = { group: null, polygon: null };
		this._contentCreated = false;
		this._cachedPoints = null;
		this._renderKey = null;
		this._pathParts = [];
	}
}

export default Area;