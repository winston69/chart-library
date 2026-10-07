// ──────────────────────────────────────────────────────────────
// InteractionLayer.js - Pan / Zoom / Axis-drag via mouse + wheel
// ──────────────────────────────────────────────────────────────

import { SVG } from '../core/SVG.js';
import { CSS } from '../core/CSS.js';
import { Layer } from '../core/Layer.js';
import { Events } from '../core/Events.js';

const css = CSS.interaction || {};

export class InteractionLayer extends Layer {
	constructor(o = {}) {
		super({
			id: o.id,
			type: 'interaction',
			name: o.name || 'Interaction',
			label: o.label || 'Interaction',
			plane: o.plane,
			onUpdate: o.onUpdate,
			onDestroy: o.onDestroy
		});

		this.slot = 'overlay';
		this.z = 5;

		this.isDataLayer = false;
		this.needsMargin = false;

		// ─── CONFIG ───
		this.enablePan = o.enablePan !== undefined ? o.enablePan : true;
		this.enableZoom = o.enableZoom !== undefined ? o.enableZoom : true;
		this.enableWheelZoom = o.enableWheelZoom !== undefined ? o.enableWheelZoom : true;
		this.enableAxisZoom = o.enableAxisZoom !== undefined ? o.enableAxisZoom : true;
		this.wheelZoomFactor = o.wheelZoomFactor || 1.15;
		this.minZoomSpan = o.minZoomSpan || 1000;
		this.showZoomRect = o.showZoomRect !== undefined ? o.showZoomRect : true;

		// Axis-drag sensitivity: a drag of the plot's full extent changes
		// the domain by this factor.
		this.axisDragFactor = o.axisDragFactor || 1.0;

		// ─── MODIFIER BEHAVIOR (per mode) ───
		this.defaultPanAxis = o.defaultPanAxis || 'x';
		this.defaultZoomAxis = o.defaultZoomAxis || 'both';

		this.panShiftAxis = o.panShiftAxis || o.shiftAxis || 'y';
		this.panAltAxis = o.panAltAxis || o.altAxis || 'both';

		this.zoomShiftAxis = o.zoomShiftAxis || o.shiftAxis || 'x';
		this.zoomAltAxis = o.zoomAltAxis || o.altAxis || 'y';

		// ─── WHEEL MODIFIER BEHAVIOR ───
		this.wheelDefaultAxis = o.wheelDefaultAxis || 'x';
		this.wheelShiftAxis = o.wheelShiftAxis || 'y';
		this.wheelAltAxis = o.wheelAltAxis || 'both';

		// ─── DOM ───
		this._elements = Object.create(null);
		this._elements.group = null;
		this._elements.zoomRect = null;
		this._svgEl = null;

		// ─── STATE ───
		this._contentCreated = false;
		this._dragState = null;
		this._boundHandlers = Object.create(null);

		// ─── BATCHING ───
		this._panAccum = { dx: 0, dy: 0, axis: null };
		this._panRafId = null;
	}

	// ──────────────────────────────────────────────────────────
	// LIFECYCLE
	// ──────────────────────────────────────────────────────────

	render(container) {
		if (!this._contentCreated) {
			this._createContent(container);
			this._contentCreated = true;
		}
		return this._elements.group;
	}

	update() {
		this._updateCount++;
		return this;
	}

	destroy() {
		if (this._panRafId !== null) {
			cancelAnimationFrame(this._panRafId);
			this._panRafId = null;
		}
		this._unbindEvents();
		super.destroy();
		if (this._elements.group && this._elements.group.parentNode) {
			this._elements.group.parentNode.removeChild(this._elements.group);
		}
		this._elements = Object.create(null);
		this._contentCreated = false;
	}

	// ──────────────────────────────────────────────────────────
	// DOM
	// ──────────────────────────────────────────────────────────

	_createContent(container) {
		const g = SVG.create('g', {
			id: `${this.id}-group`,
			class: css.container || 'int-container'
		});
		SVG.append(container, g);
		this._elements.group = g;

		this._elements.zoomRect = SVG.create('rect', {
			id: `${this.id}-zoom-rect`,
			class: css.zoomRect || 'int-zoom-rect',
			x: 0, y: 0, width: 0, height: 0,
			visibility: 'hidden',
			'pointer-events': 'none'
		});
		SVG.append(g, this._elements.zoomRect);

		this._bindEvents();
	}

	// ──────────────────────────────────────────────────────────
	// EVENT BINDING
	// ──────────────────────────────────────────────────────────

	_bindEvents() {
		const plane = this.plane;
		if (!plane || !plane._elements.svg) return;

		const svg = plane._elements.svg;
		this._svgEl = svg;                              // ← add this

		this._boundHandlers.onMouseDown = (e) => this._onMouseDown(e);
		this._boundHandlers.onMouseMove = (e) => this._onMouseMove(e);
		this._boundHandlers.onMouseUp = (e) => this._onMouseUp(e);
		this._boundHandlers.onWheel = (e) => this._onWheel(e);
		this._boundHandlers.onDoubleClick = (e) => this._onDoubleClick(e);
		this._boundHandlers.onHoverMove = (e) => this._onHoverMove(e);

		svg.addEventListener('mousemove', this._boundHandlers.onHoverMove);

		svg.addEventListener('mousedown', this._boundHandlers.onMouseDown);
		window.addEventListener('mousemove', this._boundHandlers.onMouseMove);
		window.addEventListener('mouseup', this._boundHandlers.onMouseUp);
		svg.addEventListener('wheel', this._boundHandlers.onWheel, { passive: false });
		svg.addEventListener('dblclick', this._boundHandlers.onDoubleClick);
	}

	_unbindEvents() {
		const plane = this.plane;
		if (!plane || !plane._elements.svg) return;
		const svg = plane._elements.svg;

		svg.removeEventListener('mousemove', this._boundHandlers.onHoverMove);
		svg.removeEventListener('mousedown', this._boundHandlers.onMouseDown);
		window.removeEventListener('mousemove', this._boundHandlers.onMouseMove);
		window.removeEventListener('mouseup', this._boundHandlers.onMouseUp);
		svg.removeEventListener('wheel', this._boundHandlers.onWheel);
		svg.removeEventListener('dblclick', this._boundHandlers.onDoubleClick);

		this._svgEl = null;
		this._boundHandlers = Object.create(null);
	}

	// ──────────────────────────────────────────────────────────
	// POINTER HANDLERS
	// ──────────────────────────────────────────────────────────

	_onHoverMove(e) {
		if (this._dragState) return;   // cursor is owned by the drag

		const pt = SVG.getPoint(this.plane._elements.svg, e);
		if (!pt) return;

		if (!this.enableAxisZoom) {
			if (this._svgEl) this._svgEl.style.cursor = '';
			return;
		}

		const hit = this._hitTestAxis(pt.x, pt.y);
		const next = hit
			? (hit.axis === 'x' ? 'ew-resize' : 'ns-resize')
			: '';

		if (this._svgEl && this._svgEl.style.cursor !== next) {
			this._svgEl.style.cursor = next;
		}
	}

	_onMouseDown(e) {
		if (e.button !== 0) return;

		const pt = SVG.getPoint(this.plane._elements.svg, e);
		if (!pt) return;

		const plane = this.plane;

		// ─── Axis drag takes priority over pan / zoom-rect. ───
		if (this.enableAxisZoom) {
			const hit = this._hitTestAxis(pt.x, pt.y);

			if (hit) {
				// Visual feedback: highlight the dragged axis.
				if (hit.layer._elements && hit.layer._elements.group) {
					hit.layer._elements.group.classList.add('axis-dragging');
				}

				const group = hit.groupId ? plane._yGroups[hit.groupId] : null;
				this._dragState = {
					mode: 'axis-drag',
					axis: hit.axis,
					layer: hit.layer,
					groupId: hit.groupId,
					startX: pt.x,
					startY: pt.y,
					lastX: pt.x,
					lastY: pt.y,
					startDomainX: hit.axis === 'x' ? [...plane.xScale.domain] : null,
					startDomainY: (hit.axis === 'y' && group && group.yScale)
						? [...group.yScale.domain]
						: null
				};

				if (this._svgEl) {
					this._svgEl.style.cursor = hit.axis === 'x' ? 'ew-resize' : 'ns-resize';
				}

				e.preventDefault();
				return;
			}
		}

		// ─── Pan / zoom-rect only inside the plot area. ───
		if (!this._isInsidePlot(pt.x, pt.y)) return;

		let mode = plane.interactionMode;
		if (e.ctrlKey || e.metaKey) mode = 'zoom';
		else if (e.shiftKey && mode === 'zoom') mode = 'zoom';

		if (mode === 'pan' && !this.enablePan) return;
		if (mode === 'zoom' && !this.enableZoom) return;

		let axis;
		if (mode === 'zoom') {
			axis = this.defaultZoomAxis;
			if (e.shiftKey) axis = this.zoomShiftAxis;
			if (e.altKey) axis = this.zoomAltAxis;
		} else {
			axis = this.defaultPanAxis;
			if (e.shiftKey) axis = this.panShiftAxis;
			if (e.altKey) axis = this.panAltAxis;
		}

		this._dragState = {
			mode,
			axis,
			startX: pt.x,
			startY: pt.y,
			lastX: pt.x,
			lastY: pt.y,
			startDomainX: [...plane.xScale.domain],
			startDomainsY: Object.create(null)
		};

		for (const gid in plane._yGroups) {
			const group = plane._yGroups[gid];
			if (group.yScale) {
				this._dragState.startDomainsY[gid] = [...group.yScale.domain];
			}
		}

		e.preventDefault();
	}

	_onMouseMove(e) {
		if (!this._dragState) return;
		const pt = SVG.getPoint(this.plane._elements.svg, e);
		if (!pt) return;

		const plane = this.plane;
		const ds = this._dragState;

		if (ds.mode === 'pan') {
			this._panAccum.dx += pt.x - ds.lastX;
			this._panAccum.dy += pt.y - ds.lastY;
			this._panAccum.axis = ds.axis;

			ds.lastX = pt.x;
			ds.lastY = pt.y;

			if (this._panRafId === null) {
				this._panRafId = requestAnimationFrame(() => this._flushPan());
			}
		} else if (ds.mode === 'zoom') {
			const x = Math.min(ds.startX, pt.x);
			const y = Math.min(ds.startY, pt.y);
			const w = Math.abs(pt.x - ds.startX);
			const h = Math.abs(pt.y - ds.startY);

			if (this.showZoomRect) {
				SVG.set(this._elements.zoomRect, {
					x, y, width: w, height: h,
					visibility: 'visible'
				});
			}

			ds.currentX = pt.x;
			ds.currentY = pt.y;
		} else if (ds.mode === 'axis-drag') {
			this._applyAxisDrag(ds, pt, plane);
		}

		e.preventDefault();
	}

	_onMouseUp(e) {
		if (!this._dragState) return;

		const plane = this.plane;
		const ds = this._dragState;

		if (this._panRafId !== null) {
			cancelAnimationFrame(this._panRafId);
			this._panRafId = null;
		}

		if (ds.mode === 'pan') {
			this._flushPan();
		} else if (ds.mode === 'zoom' && ds.currentX !== undefined) {
			this._applyZoomRect(ds, plane);
		} else if (ds.mode === 'axis-drag') {
			// Remove the visual highlight.
			if (ds.layer && ds.layer._elements && ds.layer._elements.group) {
				ds.layer._elements.group.classList.remove('axis-dragging');
			}
		}

		if (this._elements.zoomRect) {
			SVG.set(this._elements.zoomRect, { visibility: 'hidden', width: 0, height: 0 });
		}

		if (this._svgEl) this._svgEl.style.cursor = '';

		this._dragState = null;
		e.preventDefault();
	}

	_onWheel(e) {
		if (!this.enableWheelZoom) return;
		const pt = SVG.getPoint(this.plane._elements.svg, e);
		if (!pt) return;
		if (!this._isInsidePlot(pt.x, pt.y)) return;

		const plane = this.plane;
		const factor = e.deltaY < 0 ? this.wheelZoomFactor : 1 / this.wheelZoomFactor;

		const anchorX = plane.xScale.toData(pt.x);

		let axis = this.wheelDefaultAxis;
		if (e.shiftKey) axis = this.wheelShiftAxis;
		if (e.altKey) axis = this.wheelAltAxis;

		if (axis === 'x' || axis === 'both') {
			plane.zoom(factor, anchorX, 'x');
		}

		if (axis === 'y' || axis === 'both') {
			for (const gid in plane._yGroups) {
				const group = plane._yGroups[gid];
				if (!group.yScale) continue;
				const anchorY = group.yScale.toData(pt.y);
				plane.zoom(factor, anchorY, 'y', gid);
			}
		}

		e.preventDefault();
	}

	_onDoubleClick(e) {
		const pt = SVG.getPoint(this.plane._elements.svg, e);
		if (!pt) return;

		if (this.enableAxisZoom) {
			const hit = this._hitTestAxis(pt.x, pt.y);
			if (hit) {
				this.plane.resetZoom(hit.axis);
				e.preventDefault();
				return;
			}
		}

		if (!this._isInsidePlot(pt.x, pt.y)) return;
		this.plane.resetZoom('both');
		e.preventDefault();
	}

	// ──────────────────────────────────────────────────────────
	// AXIS DRAG
	// ──────────────────────────────────────────────────────────

	/**
	 * Returns the axis under (px, py), or null. Checks the plane's
	 * margin boxes: bottom/top for x-axes, left/right for y-axes.
	 * Only axes with `type === 'axis'` are considered.
	 */
	_hitTestAxis(px, py) {
		const plane = this.plane;
		if (!plane) return null;

		const plot = plane.getPlotArea();
		const margins = plane.margins;
		const layers = plane.getLayers();

		for (let i = 0, len = layers.length; i < len; i++) {
			const layer = layers[i];
			if (layer.type !== 'axis') continue;

			const o = layer.orientation;

			if (o === 'bottom') {
				if (px >= plot.left && px <= plot.right &&
					py >= plot.bottom && py <= plot.bottom + margins.bottom) {
					return { axis: 'x', layer, groupId: null };
				}
			} else if (o === 'top') {
				if (px >= plot.left && px <= plot.right &&
					py >= plot.top - margins.top && py <= plot.top) {
					return { axis: 'x', layer, groupId: null };
				}
			} else if (o === 'right') {
				const bb = typeof layer._getBandBounds === 'function'
					? layer._getBandBounds() : null;
				const top = bb ? bb.top : plot.top;
				const bottom = bb ? bb.bottom : plot.bottom;
				if (py >= top && py <= bottom &&
					px >= plot.right && px <= plot.right + margins.right) {
					return { axis: 'y', layer, groupId: layer.bandGroupId || null };
				}
			} else if (o === 'left') {
				const bb = typeof layer._getBandBounds === 'function'
					? layer._getBandBounds() : null;
				const top = bb ? bb.top : plot.top;
				const bottom = bb ? bb.bottom : plot.bottom;
				if (py >= top && py <= bottom &&
					px >= plot.left - margins.left && px <= plot.left) {
					return { axis: 'y', layer, groupId: layer.bandGroupId || null };
				}
			}
		}
		return null;
	}

	/**
	 * Applies one frame of axis-drag. The domain delta is proportional
	 * to the pointer delta since the last frame, anchored at the middle
	 * of the current domain.
	 */
	_applyAxisDrag(ds, pt, plane) {
		const plot = plane.getPlotArea();

		if (ds.axis === 'x') {
			const dx = pt.x - ds.lastX;
			ds.lastX = pt.x;
			ds.lastY = pt.y;

			const base = plot.width > 0 ? plot.width : 1;
			const factor = 1 + (dx / base) * this.axisDragFactor;
			if (!isFinite(factor) || factor <= 0 || factor === 1) return;

			const d = plane.xScale.domain;
			const anchor = (d[0] + d[1]) / 2;
			plane.zoom(factor, anchor, 'x');
		} else {
			const dy = pt.y - ds.lastY;
			ds.lastX = pt.x;
			ds.lastY = pt.y;

			const base = plot.height > 0 ? plot.height : 1;
			const factor = 1 + (dy / base) * this.axisDragFactor;
			if (!isFinite(factor) || factor <= 0 || factor === 1) return;

			const groupIds = ds.groupId
				? [ds.groupId]
				: Object.keys(plane._yGroups);

			for (let i = 0, len = groupIds.length; i < len; i++) {
				const gid = groupIds[i];
				const group = plane._yGroups[gid];
				if (!group || !group.yScale) continue;
				const d = group.yScale.domain;
				const anchor = (d[0] + d[1]) / 2;
				plane.zoom(factor, anchor, 'y', gid);
			}
		}
	}

	// ──────────────────────────────────────────────────────────
	// ZOOM RECT
	// ──────────────────────────────────────────────────────────

	_applyZoomRect(ds, plane) {
		const area = plane.getPlotArea();
		const x0 = Math.min(ds.startX, ds.currentX);
		const x1 = Math.max(ds.startX, ds.currentX);
		const y0 = Math.min(ds.startY, ds.currentY);
		const y1 = Math.max(ds.startY, ds.currentY);

		if (x1 - x0 < 5 && y1 - y0 < 5) return;

		const xMin0 = x0 < area.left ? area.left : x0;
		const xMax0 = x1 > area.right ? area.right : x1;
		const yMin0 = y0 < area.top ? area.top : y0;
		const yMax0 = y1 > area.bottom ? area.bottom : y1;

		if (ds.axis === 'x' || ds.axis === 'both') {
			const dataX0 = plane.xScale.toData(xMin0);
			const dataX1 = plane.xScale.toData(xMax0);
			const newXMin = Math.min(dataX0, dataX1);
			const newXMax = Math.max(dataX0, dataX1);
			if (newXMax - newXMin > this.minZoomSpan) {
				plane.xScale.domain = [newXMin, newXMax];
				plane._xDomainLocked = true;
				plane.events.emit(Events.SCALE_DOMAIN_CHANGED, {
					plane: plane, axis: 'x', domain: plane.xScale.domain
				});
			}
		}

		if (ds.axis === 'y' || ds.axis === 'both') {
			for (const gid in plane._yGroups) {
				const group = plane._yGroups[gid];
				if (!group.yScale) continue;

				const bandTop = group._yTop;
				const bandBottom = group._yBottom;

				if (yMax0 < bandTop || yMin0 > bandBottom) continue;

				const yIn0 = Math.max(yMin0, bandTop);
				const yIn1 = Math.min(yMax0, bandBottom);

				const dataY0 = group.yScale.toData(yIn0);
				const dataY1 = group.yScale.toData(yIn1);
				const newYMin = Math.min(dataY0, dataY1);
				const newYMax = Math.max(dataY0, dataY1);
				if (newYMax - newYMin > 0) {
					group.yScale.domain = [newYMin, newYMax];
					plane._yDomainLocked[gid] = true;
					plane.events.emit(Events.SCALE_DOMAIN_CHANGED, {
						plane: plane, axis: 'y', groupId: gid, domain: group.yScale.domain
					});
				}
			}
		}

		plane._requestUpdate();
	}

	// ──────────────────────────────────────────────────────────
	// PAN BATCHING
	// ──────────────────────────────────────────────────────────

	_flushPan() {
		this._panRafId = null;

		const acc = this._panAccum;
		if (acc.dx === 0 && acc.dy === 0) return;

		const dx = acc.dx;
		const dy = acc.dy;
		const axis = acc.axis;
		acc.dx = 0;
		acc.dy = 0;
		acc.axis = null;

		const plane = this.plane;
		if (!plane) return;

		if (axis === 'x' || axis === 'both') plane.pan(dx, 0, 'x');
		if (axis === 'y' || axis === 'both') plane.pan(0, dy, 'y');
	}

	// ──────────────────────────────────────────────────────────
	// UTILITIES
	// ──────────────────────────────────────────────────────────

	_isInsidePlot(px, py) {
		const plane = this.plane;
		if (!plane) return false;
		const area = plane.getPlotArea();
		return (
			px >= area.left && px <= area.right &&
			py >= area.top && py <= area.bottom
		);
	}
}

export default InteractionLayer;

/*
Expected Test Results After the Refactor
#	Interaction			Expected
1	Pan: drag			pans x
2	Pan: Shift+drag		pans y
3	Pan: Alt+drag		pans both
4	Zoom: drag			zooms x+y
5	Zoom: Shift+drag	zooms x only ← changed
6	Zoom: Alt+drag		zooms y only ← changed
7	Wheel				zooms x
8	Shift+wheel			zooms y
9	Alt+wheel			zooms both
10	Double-click		reset
11	Ctrl/Cmd+drag		zoom override

The Full Modifier Matrix After This
Mode	Modifier		Axis
Pan		(none)			x
Pan		Shift			y
Pan		Alt				both
Pan		Shift+Alt		both (alt wins)
Zoom	(none)			both
Zoom	Shift			x
Zoom	Alt				y
Zoom	Shift+Alt		y (alt wins)
Either	Ctrl/Cmd		force zoom mode
Either	Wheel			x
Either	Shift+Wheel		y
Either	Alt+Wheel		both
*/