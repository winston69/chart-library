// ──────────────────────────────────────────────────────────────
// BandFill.js
//
// Fills the region between two source layers. The first source
// contributes the bottom edge (walked forward), the second the top
// edge (walked backward). Both must share the same x-axis and
// sample cadence.
//
// Contributes nothing to the domain — the sources already do.
// ──────────────────────────────────────────────────────────────

import { SVG } from '../core/SVG.js';
import { CSS } from '../core/CSS.js';
import { ChartLayer } from '../core/ChartLayer.js';

const css = CSS.bandFill;

export class BandFill extends ChartLayer {
	constructor(o = {}) {
		super({
			id: o.id,
			type: 'band-fill',
			name: o.name || 'BandFill',
			label: o.label || o.name || 'BandFill',
			plane: o.plane,
			onUpdate: o.onUpdate,
			onDestroy: o.onDestroy,
			data: o.data,
			xAccessor: o.xAccessor,
			yAccessor: o.yAccessor
		});

		this.lowerSource = o.lowerSource || null;
		this.upperSource = o.upperSource || null;

		// Clipped by default. The band fill lives inside the plot.
		this.clipArea = o.clipArea !== undefined ? o.clipArea : true;

		this.xScale = o.xScale || null;
		this.yScale = o.yScale || null;

		this._elements = { group: null, path: null };

		this._contentCreated = false;
		this._dataDirty = true;
		this._scaleDirty = true;
		this._plotDirty = true;

		this._d = null;
		this._renderKey = null;
		this._parts = [];
	}

	render(container) {
		if (!this.plane) throw new Error('BandFill: plane not set.');

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

		this._elements.path = SVG.create('path', {
			id: `${this.id}-path`,
			class: css.path
		});
		SVG.append(g, this._elements.path);

		if (this._color) {
			g.style.setProperty('--band-fill-color', this._color);
		}
	}

	_getSources() {
		const lower = this.lowerSource;
		const upper = this.upperSource;
		if (!lower || !upper) return null;

		const lowerData = lower.getData ? lower.getData() : lower.data;
		const upperData = upper.getData ? upper.getData() : upper.data;
		if (!lowerData || !upperData) return null;

		const xAcc = lower.xAccessor || (d => d.x);
		const yLowerAcc = lower.yAccessor || (d => d.y);
		const yUpperAcc = upper.yAccessor || (d => d.y);

		return { lowerData, upperData, xAcc, yLowerAcc, yUpperAcc };
	}

	_renderData() {
		const sources = this._getSources();
		if (!sources) return;

		const { lowerData, upperData, xAcc, yLowerAcc, yUpperAcc } = sources;

		// Walk the shorter array. The two are populated in lockstep by
		// the feed, so their lengths match; the min is defensive.
		const len = Math.min(lowerData.length, upperData.length);
		if (len === 0) {
			if (this._elements.path && this._d !== '') {
				this._elements.path.setAttribute('d', '');
				this._d = '';
			}
			return;
		}

		const plane = this.plane;
		const xScale = this.xScale || plane.xScale;
		const yScale = this.yScale || plane.getYScaleForChart(this.lowerSource);
		if (!yScale || !xScale) return;

		const xD = xScale.domain, xR = xScale.range;
		const yD = yScale.domain, yR = yScale.range;
		const key =
			xD[0] + ',' + xD[1] + '|' + xR[0] + ',' + xR[1] + '|' +
			yD[0] + ',' + yD[1] + '|' + yR[0] + ',' + yR[1] +
			'|' + len;

		if (key === this._renderKey && !this._dataDirty) return;
		this._renderKey = key;

		const parts = this._parts;
		parts.length = 0;

		// Forward along the lower edge.
		parts.push('M');
		let started = false;
		for (let i = 0; i < len; i++) {
			const d = lowerData[i];
			const px = xScale.toScreen(xAcc(d));
			const py = yScale.toScreen(yLowerAcc(d));
			if (!isFinite(px) || !isFinite(py)) continue;
			parts.push(started ? 'L' : '', px, ',', py, ' ');
			started = true;
		}

		// Backward along the upper edge, closing the shape.
		for (let i = len - 1; i >= 0; i--) {
			const d = upperData[i];
			const px = xScale.toScreen(xAcc(d));
			const py = yScale.toScreen(yUpperAcc(d));
			if (!isFinite(px) || !isFinite(py)) continue;
			parts.push('L', px, ',', py, ' ');
		}

		parts.push('Z');

		const path = parts.join('');
		if (path !== this._d) {
			this._elements.path.setAttribute('d', path);
			this._d = path;
		}

		this._applyClips(plane);
	}

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

	getStats() { return { hasData: false }; }
	getDomain() { return { hasData: false }; }
	_recalcStats() { /* no-op */ }

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
		this._d = null;
		this.update();
		return this;
	}

	destroy() {
		super.destroy();
		const group = this._elements.group;
		if (group && group.parentNode) group.parentNode.removeChild(group);
		this._elements = { group: null, path: null };
		this._contentCreated = false;
		this._d = null;
		this._renderKey = null;
		this._parts = [];
	}
}

export default BandFill;