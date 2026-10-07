// ──────────────────────────────────────────────────────────────
// GhostLine.js
//
// A dashed polyline that renders a source layer's data, or its own
// data if no source is given. Never contributes to the domain.
// Unclipped by default — the ghost is meant to bleed past the band
// edges, matching the "outline through a window frame" idiom.
// ──────────────────────────────────────────────────────────────

import { SVG } from '../core/SVG.js';
import { CSS } from '../core/CSS.js';
import { ChartLayer } from '../core/ChartLayer.js';

const css = CSS.ghostLine;

export class GhostLine extends ChartLayer {
	constructor(o = {}) {
		super({
			id: o.id,
			type: 'ghost',
			name: o.name || 'GhostLine',
			label: o.label || o.name || 'GhostLine',
			plane: o.plane,
			onUpdate: o.onUpdate,
			onDestroy: o.onDestroy,
			data: o.data,
			xAccessor: o.xAccessor,
			yAccessor: o.yAccessor
		});

		// Optional source layer. When set, this layer renders the
		// source's data and accessors instead of its own.
		this.sourceLayer = o.sourceLayer || null;

		// Unclipped by default. The ghost is a "projection through the
		// frame" — it extends past the band edges on purpose.
		this.clipArea = o.clipArea !== undefined ? o.clipArea : false;

		// Scales. Resolved from the plane at render time if null.
		this.xScale = o.xScale || null;
		this.yScale = o.yScale || null;

		// DOM
		this._elements = { group: null, path: null };

		// State
		this._contentCreated = false;
		this._dataDirty = true;
		this._scaleDirty = true;
		this._plotDirty = true;

		// Caches
		this._d = null;
		this._renderKey = null;

		// Scratch
		this._parts = [];

		if (!this.sourceLayer && this.data.length > 0) {
			this._recalcStats(this.data);
		}
	}

	// ─── Render ───
	render(container) {
		if (!this.plane) throw new Error('GhostLine: plane not set.');

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
		if (this.sourceLayer && this.sourceLayer.xAccessor) {
			return this.sourceLayer.xAccessor;
		}
		return this.xAccessor;
	}

	_getYAccessor() {
		if (this.sourceLayer && this.sourceLayer.yAccessor) {
			return this.sourceLayer.yAccessor;
		}
		return this.yAccessor;
	}

	// ─── Data rendering ───
	_renderData() {
		const data = this._getData();
		const len = data ? data.length : 0;

		if (len === 0) {
			if (this._elements.path && this._d !== '') {
				this._elements.path.setAttribute('points', '');
				this._d = '';
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
			yD[0] + ',' + yD[1] + '|' + yR[0] + ',' + yR[1];

		if (key === this._renderKey && !this._dataDirty) return;
		this._renderKey = key;

		const xAcc = this._getXAccessor();
		const yAcc = this._getYAccessor();

		const parts = this._parts;
		parts.length = 0;

		for (let i = 0; i < len; i++) {
			const d = data[i];
			const px = xScale.toScreen(xAcc(d));
			const py = yScale.toScreen(yAcc(d));
			if (!isFinite(px) || !isFinite(py)) continue;
			parts.push(px, ',', py, ' ');
		}

		if (parts.length > 0) parts.length -= 1;

		const points = parts.join('');
		if (points !== this._d) {
			this._elements.path.setAttribute('points', points);
			this._d = points;
		}

		this._applyClips(plane);
	}

	// ─── Clipping ───
	_getEffectiveClip(plane) {
		if (this.clipArea === true) return { line: true };
		if (this.clipArea === false) return { line: false };

		// Object form: { line: boolean }
		const planeClip = plane.clipArea || { ghost: false };
		return {
			line: this.clipArea.line !== undefined
				? this.clipArea.line
				: planeClip.ghost
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
	// Ghosts never contribute to the domain. This is what keeps them
	// from shifting the y-scale or x-domain of the band they render
	// into.
	getStats() {
		return { hasData: false };
	}

	getDomain() {
		return { hasData: false };
	}

	_recalcStats() {
		// No-op. Ghosts do not track domain-relevant state.
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

	// ─── Lifecycle ───
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

export default GhostLine;