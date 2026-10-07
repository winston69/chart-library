// ──────────────────────────────────────────────────────────────
// Points.js
// ──────────────────────────────────────────────────────────────

import { SVG } from '../core/SVG.js';
import { CSS } from '../core/CSS.js';
import { ChartLayer } from '../core/ChartLayer.js';

const css = CSS.points;

export class Points extends ChartLayer {
	constructor(options = {}) {
		super({
			id: options.id,
			type: 'points',
			name: options.name || 'Points',
			label: options.label || options.name || 'Points',
			plane: options.plane,
			onUpdate: options.onUpdate,
			onDestroy: options.onDestroy,
			data: options.data,
			xAccessor: options.xAccessor,
			yAccessor: options.yAccessor
		});

		this.sourceLayer = options.sourceLayer || null;

		// ─── RADIUS ───
		// Resolved once. A missing variable throws in CSS.getNumber.
		this.radius = options.radius !== undefined
			? options.radius
			: CSS.getNumber('--points-radius');

		// ─── CLIPPING ───
		this.clipArea = options.clipArea !== undefined ? options.clipArea : true;

		// ─── SCALES ───
		this.xScale = options.xScale || null;
		this.yScale = options.yScale || null;

		// ─── DOM ───
		this._elements = {
			group: null,
			pool: [],
			live: []
		};

		// ─── STATE ───
		this._contentCreated = false;
		this._dataDirty = true;
		this._scaleDirty = true;
		this._plotDirty = true;
		this._renderKey = null;
	}

	// ─── Render ───
	render(container) {
		if (!this.plane) throw new Error('Points: plane not set.');

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

		if (this._color) {
			g.style.setProperty('--points-color', this._color);
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
			'|' + len;

		if (key === this._renderKey && !this._dataDirty) return;
		this._renderKey = key;

		if (len === 0) {
			this._poolAll();
			this._applyClips(plane);
			return;
		}

		const xAcc = this._getXAccessor();
		const yAcc = this._getYAccessor();
		const radius = this.radius;

		const group = this._elements.group;
		const pool = this._elements.pool;
		const live = this._elements.live;
		const currentCount = live.length;

		let written = 0;

		for (let i = 0; i < len; i++) {
			const d = data[i];
			const px = xScale.toScreen(xAcc(d));
			const py = yScale.toScreen(yAcc(d));
			if (!isFinite(px) || !isFinite(py)) continue;

			let circle;
			if (written < currentCount) {
				circle = live[written];
				circle.setAttribute('cx', px);
				circle.setAttribute('cy', py);
				circle.setAttribute('r', radius);
				circle.setAttribute('visibility', 'visible');
			} else {
				if (pool.length > 0) {
					circle = pool.pop();
					circle.setAttribute('cx', px);
					circle.setAttribute('cy', py);
					circle.setAttribute('r', radius);
					circle.setAttribute('visibility', 'visible');
					SVG.append(group, circle);
					live.push(circle);
				} else {
					circle = SVG.create('circle', {
						class: css.point,
						cx: px,
						cy: py,
						r: radius
					});
					SVG.append(group, circle);
					live.push(circle);
				}
			}

			written++;
		}

		for (let i = written; i < live.length; i++) {
			const c = live[i];
			c.setAttribute('visibility', 'hidden');
			pool.push(c);
		}
		if (written < live.length) live.length = written;

		this._applyClips(plane);
	}

	_poolAll() {
		const live = this._elements.live;
		const pool = this._elements.pool;
		for (let i = 0, len = live.length; i < len; i++) {
			live[i].setAttribute('visibility', 'hidden');
			pool.push(live[i]);
		}
		live.length = 0;
	}

	// ─── Clipping ───
	_getEffectiveClip(plane) {
		const planeClip = plane.clipArea || { points: true };

		if (this.clipArea === undefined || this.clipArea === null) {
			return { line: planeClip.points };
		}
		if (this.clipArea === true) return { line: true };
		if (this.clipArea === false) return { line: false };
		return {
			line: this.clipArea.line !== undefined ? this.clipArea.line : planeClip.points
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
		this.update();
		return this;
	}

	// ─── Lifecycle ───
	destroy() {
		super.destroy();
		const group = this._elements.group;
		if (group && group.parentNode) group.parentNode.removeChild(group);
		this._elements = { group: null, pool: [], live: [] };
		this._contentCreated = false;
		this._renderKey = null;
	}
}

export default Points;