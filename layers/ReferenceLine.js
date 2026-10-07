// ──────────────────────────────────────────────────────────────
// ReferenceLine.js
// ──────────────────────────────────────────────────────────────

import { SVG } from '../core/SVG.js';
import { CSS } from '../core/CSS.js';
import { AnnotationLayer } from '../core/AnnotationLayer.js';
import { Events } from '../core/Events.js';

const css = CSS.referenceLine;

export class ReferenceLine extends AnnotationLayer {
	constructor(options = {}) {
		super({
			id: options.id,
			type: 'reference-line',
			name: options.name || 'Reference Line',
			plane: options.plane,
			onUpdate: options.onUpdate,
			onDestroy: options.onDestroy,
			sourceLayer: options.sourceLayer
		});

		this.z = 0;

		// ─── VALUE ───
		this.value = options.value || null;
		this.valueAccessor = options.valueAccessor || null;

		// ─── ORIENTATION ───
		this.orientation = options.orientation || 'horizontal';
		this.extendLeft = options.extendLeft !== undefined ? options.extendLeft : true;
		this.extendRight = options.extendRight !== undefined ? options.extendRight : true;

		// ─── LABEL ───
		this.label = options.label || '';
		this.showLabel = options.showLabel !== undefined ? options.showLabel : true;
		this.showValue = options.showValue !== undefined ? options.showValue : true;
		this.labelFormat = options.labelFormat || ((v) => v.toFixed(4));

		// ─── PULSE ───
		this.pulse = options.pulse !== undefined ? options.pulse : false;
		this.pulseRadius = options.pulseRadius !== undefined
			? options.pulseRadius
			: CSS.getNumber('--ref-pulse-radius');

		// ─── DOM ───
		this._elements = {
			group: null,
			line: null,
			label: null,
			pulseGroup: null,
			pulseCircle: null,
			rings: []
		};

		// ─── STATE ───
		this._contentCreated = false;
		this._currentValue = null;
		this._lastRenderedValue = null;
		this._lastRenderedX = null;
		this._lastRenderedY = null;
		this._needsUpdate = true;
		this._unsubscribeEvents = [];

		// ─── CACHES ───
		this._cachedYScale = null;
		this._cachedBandBounds = null;

		// ─── SCRATCH ───
		this._labelScratch = { x: 0, y: 0, text: '' };
	}

	// ─── Event subscriptions ───
	_setupEventListeners() {
		if (!this.plane || !this.plane.events) return;

		const events = this.plane.events;
		const sourceGroupId = this.sourceLayer ? this.sourceLayer._yGroupId : null;

		const invalidate = () => {
			this._needsUpdate = true;
			this._cachedYScale = null;
			this._cachedBandBounds = null;
		};

		const onYGroupInvalidate = (data) => {
			if (!sourceGroupId || data.groupId === sourceGroupId) invalidate();
		};

		this._unsubscribeEvents = [
			events.on(Events.PLANE_RESIZED, invalidate),
			events.on(Events.MARGINS_CHANGED, invalidate),

			events.on(Events.YGROUP_DOMAIN_CHANGED, onYGroupInvalidate),
			events.on(Events.YGROUP_LAYOUT_CHANGED, onYGroupInvalidate),

			events.on(Events.SCALE_DOMAIN_CHANGED, (data) => {
				if (data.axis === 'y' && data.groupId === sourceGroupId) {
					this._needsUpdate = true;
					this._cachedYScale = null;
				}
				if (data.axis === 'x') {
					const tracksX =
						this.orientation === 'vertical' ||
						!this.extendLeft ||
						!this.extendRight ||
						this.pulse;
					if (tracksX) this._needsUpdate = true;
				}
			}),

			events.on(Events.LAST_POINT_UPDATED, (data) => {
				if (data.layer !== this.sourceLayer) return;
				this._needsUpdate = true;
				if (this.valueAccessor && data.stats) {
					this._currentValue = this.valueAccessor(data.stats);
				} else if (data.stats) {
					this._currentValue = data.stats.lastY;
				}
			})
		];
	}

	_unsubscribeFromPlaneEvents() {
		for (let i = 0, len = this._unsubscribeEvents.length; i < len; i++) {
			try { this._unsubscribeEvents[i](); } catch (e) { /* ignore */ }
		}
		this._unsubscribeEvents = [];
	}

	// ─── Render ───
	render(container) {
		if (!this.plane) throw new Error('ReferenceLine: plane not set.');

		if (!this._contentCreated) {
			this._createContent(container);
			this._contentCreated = true;
		} else if (this._elements.group && !this._elements.group.parentNode) {
			SVG.append(container, this._elements.group);
		}

		if (this._unsubscribeEvents.length === 0) {
			this._setupEventListeners();
		}

		this._renderLine();
		return this._elements.group;
	}

	_createContent(container) {
		const g = SVG.create('g', {
			id: `${this.id}-group`,
			class: css.container
		});
		SVG.append(container, g);
		this._elements.group = g;

		this._elements.line = SVG.create('line', {
			id: `${this.id}-line`,
			class: css.line
		});
		SVG.append(g, this._elements.line);

		if (this.showLabel || this.showValue) {
			this._elements.label = SVG.create('text', {
				id: `${this.id}-label`,
				class: css.label
			});
			SVG.append(g, this._elements.label);
		}

		if (this.pulse) {
			this._createPulse(g);
		}
	}

	_createPulse(parent) {
		const pulseGroup = SVG.create('g', {
			id: `${this.id}-pulse-group`,
			visibility: 'hidden'
		});
		this._elements.pulseGroup = pulseGroup;

		const pulseCircle = SVG.create('circle', {
			id: `${this.id}-pulse`,
			class: `${css.pulse} ${css.pulseCss}`,
			cx: 0,
			cy: 0,
			r: this.pulseRadius
		});
		SVG.append(pulseGroup, pulseCircle);
		this._elements.pulseCircle = pulseCircle;

		const rings = [];
		for (let i = 0; i < 3; i++) {
			const ring = SVG.create('circle', {
				id: `${this.id}-ring-${i}`,
				class: `${css.ring} ${css.ringCss}`,
				cx: 0,
				cy: 0,
				r: this.pulseRadius * 1.5
			});
			SVG.append(pulseGroup, ring);
			rings.push(ring);
		}
		this._elements.rings = rings;

		SVG.append(parent, pulseGroup);
	}

	// ─── Value resolution ───
	_getValue() {
		if (this._currentValue !== null && this._currentValue !== undefined) {
			return this._currentValue;
		}

		if (this.valueAccessor && this.sourceLayer) {
			const stats = this.sourceLayer.getStats();
			if (stats && stats.hasData) {
				const val = this.valueAccessor(stats);
				this._currentValue = val;
				return val;
			}
		}

		if (this.value !== null && this.value !== undefined) {
			this._currentValue = this.value;
			return this.value;
		}

		return null;
	}

	// ─── Rendering ───
	_renderLine() {
		const plane = this.plane;
		if (!plane) return;

		const value = this._getValue();
		if (value === null || value === undefined || !isFinite(value)) {
			this._hideAll();
			return;
		}

		if (value === this._lastRenderedValue && !this._needsUpdate) return;

		let yScale = this._cachedYScale;
		let bandBounds = this._cachedBandBounds;

		if (!yScale || this._needsUpdate) {
			yScale = plane.yScale;
			bandBounds = null;

			if (this.sourceLayer && this.sourceLayer._yGroupId) {
				if (typeof plane.getYScaleForChart === 'function') {
					const newScale = plane.getYScaleForChart(this.sourceLayer);
					if (newScale) {
						yScale = newScale;
						this._cachedYScale = yScale;
					}
				}
				if (typeof plane.getBandBounds === 'function') {
					bandBounds = plane.getBandBounds(this.sourceLayer);
					this._cachedBandBounds = bandBounds;
				}
			}
		}

		if (!yScale) {
			this._hideAll();
			return;
		}

		const plotArea = plane.getPlotArea();
		const plotLeft = isFinite(plotArea.left) ? plotArea.left : 0;
		const plotRight = isFinite(plotArea.right) ? plotArea.right : 800;

		let top, bottom;
		if (bandBounds) {
			top = bandBounds.top;
			bottom = bandBounds.bottom;
		} else {
			top = isFinite(plotArea.top) ? plotArea.top : 0;
			bottom = isFinite(plotArea.bottom) ? plotArea.bottom : 500;
		}

		const lastX = this._resolveLastX(plotRight);
		const xPos = plane.xScale.toScreen(lastX);
		const y = yScale.toScreen(value);

		if (!isFinite(y) || y < top || y > bottom) {
			this._hideAll();
			return;
		}

		if (xPos === this._lastRenderedX &&
			y === this._lastRenderedY &&
			!this._needsUpdate) {
			return;
		}

		this._lastRenderedValue = value;
		this._lastRenderedX = xPos;
		this._lastRenderedY = y;
		this._needsUpdate = false;

		this._positionLine(xPos, y, plotLeft, plotRight, top, bottom);
		this._renderLabel(xPos, y, plotLeft, plotRight);
		this._renderPulse(xPos, y);
	}

	_resolveLastX(fallbackX) {
		if (this.sourceLayer && typeof this.sourceLayer.getData === 'function') {
			const data = this.sourceLayer.getData();
			if (data && data.length > 0) {
				const lastPoint = data[data.length - 1];
				const xAcc = this.sourceLayer.xAccessor || (d => d.x);
				if (lastPoint && typeof xAcc === 'function') {
					const x = xAcc(lastPoint);
					if (isFinite(x)) return x;
				}
			}
		}
		return fallbackX;
	}

	_positionLine(xPos, y, plotLeft, plotRight, top, bottom) {
		const line = this._elements.line;

		let x1, y1, x2, y2;
		if (this.orientation === 'horizontal') {
			x1 = this.extendLeft ? plotLeft : xPos;
			x2 = this.extendRight ? plotRight : xPos;
			y1 = y;
			y2 = y;
		} else {
			y1 = this.extendLeft ? top : (this.extendRight ? bottom : 0);
			y2 = this.extendRight ? bottom : (this.extendLeft ? top : 0);
			x1 = xPos;
			x2 = xPos;
		}

		if (!isFinite(x1)) x1 = plotLeft || 0;
		if (!isFinite(y1)) y1 = 0;
		if (!isFinite(x2)) x2 = plotRight || 800;
		if (!isFinite(y2)) y2 = 0;

		line.setAttribute('x1', x1);
		line.setAttribute('y1', y1);
		line.setAttribute('x2', x2);
		line.setAttribute('y2', y2);
		line.setAttribute('visibility', 'visible');
	}

	_renderLabel(xPos, y, plotLeft, plotRight) {
		const label = this._elements.label;
		if (!label || (!this.showLabel && !this.showValue)) return;

		let text = '';
		if (this.showLabel && this.label) text += this.label;
		if (this.showValue && isFinite(this._lastRenderedValue)) {
			const formatted = this.labelFormat(this._lastRenderedValue);
			text += text ? ': ' + formatted : formatted;
		}

		if (!text) {
			label.setAttribute('visibility', 'hidden');
			return;
		}

		const labelOffset = 4;
		const textLength = text.length * 6;

		let anchorX = xPos;
		if (anchorX < plotLeft || anchorX > plotRight) {
			anchorX = plotRight - 4;
		}

		let labelX = anchorX + 4;
		const labelY = y - labelOffset;

		if (labelX + textLength > plotRight) {
			labelX = anchorX - textLength - 4;
		}
		if (labelX < plotLeft + 4) {
			labelX = plotLeft + 4;
		}

		if (!isFinite(labelX) || !isFinite(labelY)) {
			label.setAttribute('visibility', 'hidden');
			return;
		}

		const scratch = this._labelScratch;
		if (scratch.text !== text) {
			scratch.text = text;
			label.textContent = text;
		}
		if (scratch.x !== labelX) {
			scratch.x = labelX;
			label.setAttribute('x', labelX);
		}
		if (scratch.y !== labelY) {
			scratch.y = labelY;
			label.setAttribute('y', labelY);
		}
		label.setAttribute('visibility', 'visible');
	}

	_renderPulse(xPos, y) {
		const pulseGroup = this._elements.pulseGroup;
		if (!pulseGroup || !this.pulse) return;

		if (isFinite(xPos) && isFinite(y)) {
			pulseGroup.setAttribute('transform', `translate(${xPos}, ${y})`);
			pulseGroup.setAttribute('visibility', 'visible');
		} else {
			pulseGroup.setAttribute('visibility', 'hidden');
		}
	}

	_hideAll() {
		if (this._elements.line) {
			this._elements.line.setAttribute('visibility', 'hidden');
		}
		if (this._elements.label) {
			this._elements.label.setAttribute('visibility', 'hidden');
		}
		if (this._elements.pulseGroup) {
			this._elements.pulseGroup.setAttribute('visibility', 'hidden');
		}
	}

	// ─── Update ───
	update() {
		if (!this._contentCreated) {
			if (this.plane) this.render(this.plane._elements.rootGroup);
			return this;
		}

		if (this.sourceLayer) {
			const stats = this.sourceLayer.getStats();
			if (stats && stats.hasData) {
				const newValue = this.valueAccessor ? this.valueAccessor(stats) : stats.lastY;
				if (newValue !== this._currentValue) {
					this._currentValue = newValue;
					this._needsUpdate = true;
				}
			}
		}

		if (this._needsUpdate) {
			this._renderLine();
			this._needsUpdate = false;
			this._updateCount++;
			if (this.onUpdate) this.onUpdate(this);
		} else {
			this._updateCount++;
		}
		return this;
	}

	forceUpdate() {
		this._needsUpdate = true;
		this._currentValue = null;
		this._lastRenderedValue = null;
		this._lastRenderedX = null;
		this._lastRenderedY = null;
		this._cachedYScale = null;
		this._cachedBandBounds = null;
		this._labelScratch.x = 0;
		this._labelScratch.y = 0;
		this._labelScratch.text = '';
		this.update();
		return this;
	}

	// ─── Lifecycle ───
	destroy() {
		this._unsubscribeFromPlaneEvents();
		super.destroy();

		if (this._elements.group && this._elements.group.parentNode) {
			this._elements.group.parentNode.removeChild(this._elements.group);
		}

		this._elements = {
			group: null,
			line: null,
			label: null,
			pulseGroup: null,
			pulseCircle: null,
			rings: []
		};
		this._contentCreated = false;
	}
}

export default ReferenceLine;