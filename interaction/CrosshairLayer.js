// ──────────────────────────────────────────────────────────────
// CrosshairLayer.js
// ──────────────────────────────────────────────────────────────

import { SVG } from '../core/SVG.js';
import { CSS } from '../core/CSS.js';
import { AnnotationLayer } from '../core/AnnotationLayer.js';
import { Events } from '../core/Events.js';
import { Utils } from '../core/Utils.js';

const css = CSS.crosshair;

export class CrosshairLayer extends AnnotationLayer {
	constructor(options = {}) {
		super({
			id: options.id,
			type: 'crosshair',
			name: options.name || 'Crosshair',
			plane: options.plane,
			onUpdate: options.onUpdate,
			onDestroy: options.onDestroy,
			sourceLayer: options.sourceLayer || null
		});

		this.slot = 'overlay';
		this.z = 10;

		// ─── AXES ───
		this.xAxis = options.xAxis || null;
		this.yAxes = options.yAxes || {};

		// ─── DISPLAY ───
		this.showVertical = options.showVertical !== undefined ? options.showVertical : true;
		this.showHorizontal = options.showHorizontal !== undefined ? options.showHorizontal : true;
		this.showXLabel = options.showXLabel !== undefined ? options.showXLabel : true;
		this.showYLabel = options.showYLabel !== undefined ? options.showYLabel : true;

		// ─── SNAP ───
		this.snapMode = options.snapMode || 'data-first';
		this.snapMaxDistance = options.snapMaxDistance !== undefined ? options.snapMaxDistance : 30;

		// ─── SNAP INDICATOR ───
		this.showSnapDot = options.showSnapDot !== undefined ? options.showSnapDot : true;
		this.snapRadius = options.snapDotRadius !== undefined
			? options.snapDotRadius
			: CSS.getNumber('--crosshair-snap-radius');

		// ─── FORMATTERS ───
		this.xFormatter = options.xFormatter || null;
		this.yFormatter = options.yFormatter || null;

		// ─── CALLBACK ───
		this.onMove = options.onMove || null;

		// ─── DOM ───
		this._elements = {
			group: null,
			vLine: null,
			xLabel: null,
			snapDot: null,
			bandGroups: Object.create(null)
		};

		// ─── PAYLOAD SCRATCH ───
		this._movePayload = {
			event: null,
			pixel: { x: 0, y: 0 },
			data: { x: 0, y: 0 },
			labels: { x: '', y: '' },
			groupId: null,
			yAxis: null,
			snapKind: 'free',
			snapSource: null,
			snapSample: null,
			pointKind: null
		};

		// ─── SNAP SCRATCH ───
		this._snapScratch = {
			kind: 'free',
			xPixel: 0,
			xValue: 0,
			xLabel: '',
			layer: null,
			sample: null,
			sampleX: 0,
			sampleY: 0,
			sampleIndex: -1,
			sampleGroupId: null,
			pointKind: null
		};

		// ─── DIFF STATE ───
		this._lastVX = null;
		this._lastVLabel = null;
		this._lastVLabelX = null;
		this._lastVLabelY = null;
		this._lastHGroupId = null;
		this._lastHY = null;
		this._lastHLabel = null;
		this._lastSnapDotKey = null;
		this._visible = false;

		this._unsubscribeEvents = [];
		this._contentCreated = false;
		this._activeGroupId = null;
		this._svgEl = null;

		this._onMouseMove = this._onMouseMove.bind(this);
		this._onMouseLeave = this._onMouseLeave.bind(this);
	}

	// ─── Event subscriptions ───
	_setupEventListeners() {
		if (!this.plane || !this.plane.events) return;
		const events = this.plane.events;

		const onInvalidate = () => this._hideAll();
		const onYGroupLayout = () => {
			this._syncBandGroups();
			this._hideAll();
		};

		this._unsubscribeEvents = [
			events.on(Events.YGROUP_LAYOUT_CHANGED, onYGroupLayout),
			events.on(Events.YGROUP_DOMAIN_CHANGED, onInvalidate),
			events.on(Events.MARGINS_CHANGED, onInvalidate),
			events.on(Events.PLANE_RESIZED, onInvalidate)
		];
	}

	_unsubscribeFromPlaneEvents() {
		for (let i = 0, len = this._unsubscribeEvents.length; i < len; i++) {
			try { this._unsubscribeEvents[i](); } catch (e) { /* ignore */ }
		}
		this._unsubscribeEvents = [];
		this._detachPointer();
	}

	_syncBandGroups() {
		const plane = this.plane;
		if (!plane || !plane._yGroupOrder) return;
		for (let i = 0, len = plane._yGroupOrder.length; i < len; i++) {
			this._createBandGroup(plane._yGroupOrder[i]);
		}
	}

	// ─── Render ───
	render(container) {
		if (!this.plane) throw new Error('CrosshairLayer: plane not set.');

		if (!this._contentCreated) {
			this._createContent(container);
			this._contentCreated = true;
		} else if (this._elements.group && !this._elements.group.parentNode) {
			SVG.append(container, this._elements.group);
		}

		if (!this._svgEl) this._attachPointer();
		if (this._unsubscribeEvents.length === 0) this._setupEventListeners();

		this._updateStaticGeometry();
		return this._elements.group;
	}

	_createContent(container) {
		const g = SVG.create('g', {
			id: `${this.id}-group`,
			class: css.container,
			visibility: 'hidden',
			'pointer-events': 'none'
		});
		SVG.append(container, g);
		this._elements.group = g;

		if (this.showVertical) {
			this._elements.vLine = SVG.create('line', {
				id: `${this.id}-v`,
				class: css.vertical,
				x1: 0, y1: 0, x2: 0, y2: 0
			});
			SVG.append(g, this._elements.vLine);
		}

		this._syncBandGroups();

		if (this.showXLabel) {
			this._elements.xLabel = SVG.create('text', {
				id: `${this.id}-label-x`,
				class: css.labelX,
				'text-anchor': 'middle',
				'dominant-baseline': 'hanging'
			});
			SVG.append(g, this._elements.xLabel);
		}

		if (this.showSnapDot) {
			this._elements.snapDot = SVG.create('circle', {
				id: `${this.id}-snap-dot`,
				class: css.snapDot,
				cx: 0,
				cy: 0,
				r: this.snapRadius,
				visibility: 'hidden'
			});
			SVG.append(g, this._elements.snapDot);
		}
	}

	_createBandGroup(groupId) {
		if (this._elements.bandGroups[groupId]) return;

		const g = SVG.create('g', {
			id: `${this.id}-band-${groupId}`,
			class: css.bandGroup,
			visibility: 'hidden'
		});
		SVG.append(this._elements.group, g);

		const hLine = SVG.create('line', {
			id: `${this.id}-h-${groupId}`,
			class: css.horizontal,
			x1: 0, y1: 0, x2: 0, y2: 0
		});
		SVG.append(g, hLine);

		let yLabel = null;
		if (this.showYLabel) {
			yLabel = SVG.create('text', {
				id: `${this.id}-label-y-${groupId}`,
				class: css.labelY,
				'text-anchor': 'end',
				'dominant-baseline': 'middle'
			});
			SVG.append(g, yLabel);
		}

		this._elements.bandGroups[groupId] = { g, hLine, yLabel };
	}

	// ─── Pointer wiring ───
	_attachPointer() {
		const svg = this.plane && this.plane._elements && this.plane._elements.svg;
		if (!svg) return;
		this._svgEl = svg;
		svg.addEventListener('mousemove', this._onMouseMove);
		svg.addEventListener('mouseleave', this._onMouseLeave);
	}

	_detachPointer() {
		if (!this._svgEl) return;
		this._svgEl.removeEventListener('mousemove', this._onMouseMove);
		this._svgEl.removeEventListener('mouseleave', this._onMouseLeave);
		this._svgEl = null;
	}

	// ─── Pointer handlers ───
	_onMouseMove(evt) {
		const plane = this.plane;
		if (!plane) return;

		const pt = SVG.getPoint(plane._elements.svg, evt);
		if (!pt) return;

		const plot = plane.getPlotArea();
		if (!plot || !isFinite(plot.left)) return;

		if (pt.x < plot.left || pt.x > plot.right || pt.y < plot.top || pt.y > plot.bottom) {
			this._hideAll();
			return;
		}

		const snap = this._resolveSnap(pt, plot);
		const groupId = this._findGroupAtY(pt.y);

		let yPixel = pt.y;
		let yLabel = null;
		let yValue = null;
		let yAxis = null;

		if (groupId) {
			yAxis = this.yAxes[groupId] || null;

			if (snap.kind === 'data' && snap.sampleGroupId === groupId) {
				const sampleY = snap.sampleY;
				const scale = plane._yGroups[groupId] ? plane._yGroups[groupId].yScale : null;
				if (isFinite(sampleY) && scale) {
					yPixel = scale.toScreen(sampleY);
					yValue = sampleY;
					yLabel = this._formatYFromSample(snap.layer, sampleY, groupId, yAxis);
				}
			}

			if (yLabel === null) {
				if (yAxis && typeof yAxis.snapToPixel === 'function') {
					const ySnap = yAxis.snapToPixel(pt.y);
					if (ySnap) {
						yPixel = yAxis.scale.toScreen(ySnap.value);
						yValue = ySnap.value;
						yLabel = ySnap.label;
					}
				}
				if (yLabel === null) {
					yValue = this._toDataY(groupId, pt.y);
					yLabel = this.yFormatter
						? this.yFormatter(yValue, groupId, yAxis)
						: this._defaultYFormat(yValue, yAxis);
				}
			}
		}

		this._showVerticalOnly(snap.xPixel, snap.xLabel);

		if (groupId) {
			this._showHorizontalFor(groupId, yPixel, yLabel);
		} else {
			this._hideAllHorizontal();
		}

		this._setVisible(true);
		this._updateSnapDot(snap, groupId, yPixel);

		if (this.onMove) {
			const payload = this._movePayload;
			payload.event = evt;
			payload.pixel.x = snap.xPixel;
			payload.pixel.y = yPixel;
			payload.data.x = snap.xValue;
			payload.data.y = yValue;
			payload.labels.x = snap.xLabel;
			payload.labels.y = yLabel;
			payload.groupId = groupId;
			payload.yAxis = yAxis;
			payload.snapKind = snap.kind;
			payload.snapSource = snap.layer || null;
			payload.pointKind = snap.pointKind || null;

			if (snap.sample) {
				if (!payload.snapSample) payload.snapSample = { x: 0, y: 0, index: 0 };
				payload.snapSample.x = snap.sampleX;
				payload.snapSample.y = snap.sampleY;
				payload.snapSample.index = snap.sampleIndex;
			} else {
				payload.snapSample = null;
			}

			this.onMove(payload);
		}
	}

	_onMouseLeave() {
		this._hideAll();
	}

	// ─── Snap resolution ───
	_resolveSnap(pt, plot) {
		const plane = this.plane;
		const xValue = plane.xScale.toData(pt.x);
		const out = this._snapScratch;

		if (this.snapMode === 'data-first') {
			const hoveredGroupId = this._findGroupAtY(pt.y);

			if (hoveredGroupId) {
				const candidates = this._collectCandidates(hoveredGroupId);

				if (candidates && candidates.length > 0) {
					const found = this._findBestDataSnap(
						candidates, xValue, pt.x, pt.y, hoveredGroupId
					);
					if (found) {
						out.kind = 'data';
						out.xPixel = found.xPixel;
						out.xValue = found.sampleX;
						out.xLabel = found.xLabel;
						out.layer = found.layer;
						out.sample = found.sample;
						out.sampleX = found.sampleX;
						out.sampleY = found.sampleY;
						out.sampleIndex = found.sampleIndex;
						out.sampleGroupId = hoveredGroupId;
						out.pointKind = found.pointKind;
						return out;
					}
				}
			}
		}

		if (this.snapMode !== 'off') {
			if (this.xAxis && typeof this.xAxis.snapToPixel === 'function') {
				const tickSnap = this.xAxis.snapToPixel(pt.x);
				if (tickSnap) {
					out.kind = 'tick';
					out.xPixel = this.xAxis.scale.toScreen(tickSnap.value);
					out.xValue = tickSnap.value;
					out.xLabel = tickSnap.label;
					out.layer = null;
					out.sample = null;
					out.sampleGroupId = null;
					out.pointKind = null;
					return out;
				}
			}
		}

		const xLabel = this.xFormatter
			? this.xFormatter(xValue)
			: this._defaultXFormat(xValue);

		out.kind = 'free';
		out.xPixel = pt.x;
		out.xValue = xValue;
		out.xLabel = xLabel;
		out.layer = null;
		out.sample = null;
		out.sampleGroupId = null;
		out.pointKind = null;
		return out;
	}

	_collectCandidates(groupId) {
		const plane = this.plane;
		const selection = plane.selection;

		if (selection && !selection.isEmpty()) {
			const selected = selection.get();
			const filtered = [];
			for (let i = 0, len = selected.length; i < len; i++) {
				const l = selected[i];
				if (l.isDataLayer && l._yGroupId === groupId) filtered.push(l);
			}
			if (filtered.length > 0) return filtered;
		}

		const group = plane._yGroups[groupId];
		if (!group) return null;

		const candidates = [];
		for (let i = 0, len = group.rows.length; i < len; i++) {
			const row = group.rows[i];
			if (row.chart && row.chart.isDataLayer) candidates.push(row.chart);
		}
		return candidates;
	}

	_findBestDataSnap(candidates, xDataValue, pointerX, pointerY, groupId) {
		const plane = this.plane;
		const xScale = plane.xScale;
		const yScale = plane._yGroups[groupId] ? plane._yGroups[groupId].yScale : null;
		if (!yScale) return null;

		let bestLayer = null;
		let bestSample = null;
		let bestSampleX = 0;
		let bestSampleY = 0;
		let bestSampleIndex = -1;
		let bestPointKind = null;
		let bestXPixel = 0;
		let bestDistance = Infinity;
		let bestZ = -Infinity;

		for (let i = 0, len = candidates.length; i < len; i++) {
			const layer = candidates[i];
			const data = layer.getData ? layer.getData() : layer.data;
			if (!data || data.length === 0) continue;

			const xAccessor = layer.xAccessor || (d => d.x);
			const nearest = Utils.findNearestByX(data, xAccessor, xDataValue);
			if (!nearest) continue;

			const datum = nearest.sample;
			const sampleX = nearest.x;
			const xPixel = xScale.toScreen(sampleX);
			const z = isFinite(layer.z) ? layer.z : 0;

			const points = (typeof layer.getSnapPoints === 'function')
				? layer.getSnapPoints(datum)
				: [{ y: (layer.yAccessor || (d => d.y))(datum), kind: 'default' }];

			for (let p = 0, plen = points.length; p < plen; p++) {
				const point = points[p];
				const v = point.y;
				if (!isFinite(v)) continue;

				const yPixel = yScale.toScreen(v);
				const dx = xPixel - pointerX;
				const dy = yPixel - pointerY;
				const distance = Math.sqrt(dx * dx + dy * dy);
				if (distance > this.snapMaxDistance) continue;

				if (distance < bestDistance ||
					(distance === bestDistance && z > bestZ)) {
					bestLayer = layer;
					bestSample = datum;
					bestSampleX = sampleX;
					bestSampleY = v;
					bestSampleIndex = nearest.index;
					bestPointKind = point.kind;
					bestXPixel = xPixel;
					bestDistance = distance;
					bestZ = z;
				}
			}
		}

		if (bestLayer === null) return null;

		return {
			layer: bestLayer,
			sample: bestSample,
			sampleX: bestSampleX,
			sampleY: bestSampleY,
			sampleIndex: bestSampleIndex,
			pointKind: bestPointKind,
			xPixel: bestXPixel,
			yPixel: yScale.toScreen(bestSampleY),
			xLabel: this._formatXFromSample(bestLayer, bestSampleX)
		};
	}

	_formatXFromSample(layer, sampleX) {
		if (this.xAxis && typeof this.xAxis._formatTick === 'function') {
			const decimals = typeof this.xAxis._getEffectiveDecimals === 'function'
				? this.xAxis._getEffectiveDecimals()
				: 0;
			return this.xAxis._formatTick(sampleX, decimals);
		}
		if (this.xFormatter) return this.xFormatter(sampleX);
		return this._defaultXFormat(sampleX);
	}

	_formatYFromSample(layer, sampleY, groupId, yAxis) {
		if (yAxis && typeof yAxis._formatTick === 'function') {
			const decimals = typeof yAxis._getEffectiveDecimals === 'function'
				? yAxis._getEffectiveDecimals()
				: (layer.decimals !== undefined ? layer.decimals : 2);
			return yAxis._formatTick(sampleY, decimals);
		}
		if (this.yFormatter) return this.yFormatter(sampleY, groupId, yAxis);
		return this._defaultYFormat(sampleY, yAxis);
	}

	_updateSnapDot(snap, groupId, yPixel) {
		const dot = this._elements.snapDot;
		if (!dot) return;

		if (snap.kind !== 'data' || !snap.sampleGroupId) {
			if (this._lastSnapDotKey !== null) {
				dot.setAttribute('visibility', 'hidden');
				this._lastSnapDotKey = null;
			}
			return;
		}

		const cx = snap.xPixel;
		const cy = yPixel;
		const key = cx + ',' + cy;
		if (key === this._lastSnapDotKey) return;
		this._lastSnapDotKey = key;

		dot.setAttribute('cx', cx);
		dot.setAttribute('cy', cy);

		// Fill is data-driven: match the snapped layer's color when
		// it has one. Otherwise the CSS default applies.
		if (snap.layer && snap.layer.color) {
			dot.setAttribute('fill', snap.layer.color);
		} else {
			dot.removeAttribute('fill');
		}

		dot.setAttribute('visibility', 'visible');
	}

	// ─── Band lookup ───
	_findGroupAtY(y) {
		const plane = this.plane;
		if (!plane || !plane._yGroupOrder) return null;

		for (let i = 0, len = plane._yGroupOrder.length; i < len; i++) {
			const groupId = plane._yGroupOrder[i];
			const group = plane._yGroups[groupId];
			if (!group) continue;
			if (group._yTop === undefined || group._yBottom === undefined) continue;
			if (y >= group._yTop && y <= group._yBottom) return groupId;
		}
		return null;
	}

	_toDataY(groupId, pixelY) {
		const plane = this.plane;
		const group = plane._yGroups[groupId];
		if (!group || !group.yScale) return null;
		return group.yScale.toData(pixelY);
	}

	// ─── Default formatters ───
	_defaultXFormat(value) {
		if (!isFinite(value)) return '';
		if (this.xAxis && this.xAxis.scale && this.xAxis.scale.type === 'time') {
			const d = new Date(value);
			const hh = String(d.getHours()).padStart(2, '0');
			const mm = String(d.getMinutes()).padStart(2, '0');
			const ss = String(d.getSeconds()).padStart(2, '0');
			return `${hh}:${mm}:${ss}`;
		}
		return value.toFixed(2);
	}

	_defaultYFormat(value, axis) {
		if (value === null || value === undefined || !isFinite(value)) return '';
		const decimals = axis && typeof axis._getEffectiveDecimals === 'function'
			? axis._getEffectiveDecimals()
			: 2;
		return value.toFixed(decimals);
	}

	// ─── Static geometry ───
	_updateStaticGeometry() {
		const plane = this.plane;
		if (!plane) return;
		const plot = plane.getPlotArea();
		if (!plot || !isFinite(plot.top)) return;

		if (this._elements.vLine) {
			SVG.set(this._elements.vLine, {
				y1: plot.top,
				y2: plot.bottom
			});
		}

		const bg = this._elements.bandGroups;
		for (const groupId in bg) {
			SVG.set(bg[groupId].hLine, {
				x1: plot.left,
				x2: plot.right
			});
		}
	}

	// ─── Show / hide ───
	_setVisible(v) {
		if (this._visible === v) return;
		this._visible = v;
		if (this._elements.group) {
			this._elements.group.setAttribute('visibility', v ? 'visible' : 'hidden');
		}
	}

	_showVerticalOnly(xPixel, xLabel) {
		const el = this._elements;

		if (el.vLine && this._lastVX !== xPixel) {
			this._lastVX = xPixel;
			el.vLine.setAttribute('x1', xPixel);
			el.vLine.setAttribute('x2', xPixel);
		}

		if (this.showXLabel && el.xLabel) {
			const plane = this.plane;
			const plot = plane.getPlotArea();
			const yPos = plot.bottom + 12;
			const halfText = 30;
			const clampX = Math.max(plot.left + halfText, Math.min(plot.right - halfText, xPixel));
			const label = xLabel || '';

			if (this._lastVLabel !== label) {
				this._lastVLabel = label;
				el.xLabel.textContent = label;
			}
			if (this._lastVLabelX !== clampX) {
				this._lastVLabelX = clampX;
				el.xLabel.setAttribute('x', clampX);
			}
			if (this._lastVLabelY !== yPos) {
				this._lastVLabelY = yPos;
				el.xLabel.setAttribute('y', yPos);
			}
		}
	}

	_showHorizontalFor(groupId, yPixel, yLabel) {
		const bandGroups = this._elements.bandGroups;

		if (this._lastHGroupId !== groupId) {
			for (const gid in bandGroups) {
				if (gid !== groupId) bandGroups[gid].g.setAttribute('visibility', 'hidden');
			}
			const next = bandGroups[groupId];
			if (!next) return;
			next.g.setAttribute('visibility', 'visible');
			this._lastHGroupId = groupId;
		}

		const bg = bandGroups[groupId];
		if (!bg) return;

		const label = yLabel || '';

		if (this._lastHY !== yPixel) {
			this._lastHY = yPixel;
			bg.hLine.setAttribute('y1', yPixel);
			bg.hLine.setAttribute('y2', yPixel);
			if (bg.yLabel) bg.yLabel.setAttribute('y', yPixel);
		}

		if (bg.yLabel && this.showYLabel && this._lastHLabel !== label) {
			this._lastHLabel = label;
			bg.yLabel.textContent = label;
		}

		this._activeGroupId = groupId;
	}

	_hideAllHorizontal() {
		if (this._lastHGroupId === null) return;
		const bandGroups = this._elements.bandGroups;
		for (const gid in bandGroups) {
			bandGroups[gid].g.setAttribute('visibility', 'hidden');
		}
		this._activeGroupId = null;
		this._lastHGroupId = null;
		this._lastHY = null;
		this._lastHLabel = null;
	}

	_hideAll() {
		this._setVisible(false);
		this._hideAllHorizontal();
		if (this._elements.snapDot && this._lastSnapDotKey !== null) {
			this._elements.snapDot.setAttribute('visibility', 'hidden');
			this._lastSnapDotKey = null;
		}
		this._lastVX = null;
		this._lastVLabel = null;
		this._lastVLabelX = null;
		this._lastVLabelY = null;
		if (this.onMove) this.onMove(null);
	}

	// ─── Update / destroy ───
	update() {
		if (!this._contentCreated) {
			if (this.plane) this.render(this.plane._elements.rootGroup);
			return this;
		}

		this._updateStaticGeometry();
		this._updateCount++;
		if (this.onUpdate) this.onUpdate(this);
		return this;
	}

	destroy() {
		this._detachPointer();
		this._unsubscribeFromPlaneEvents();

		if (this._elements.group && this._elements.group.parentNode) {
			this._elements.group.parentNode.removeChild(this._elements.group);
		}

		this._elements = {
			group: null,
			vLine: null,
			xLabel: null,
			snapDot: null,
			bandGroups: Object.create(null)
		};
		this._contentCreated = false;
		this._activeGroupId = null;
		this._visible = false;

		super.destroy();
	}
}

export default CrosshairLayer;