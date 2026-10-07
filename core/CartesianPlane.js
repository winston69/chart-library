// ──────────────────────────────────────────────────────────────
// CartesianPlane.js
//
// Structured DOM, layer lifecycle, band resize, y-group management,
// fullscreen handling, and the render loop for a multi-layer chart.
//
// The plane owns: 
//   - The DOM tree (container, svg, defs, margins, plot, overlay)
//   - The layer registry and render loop
//   - Margin / layout / domain computation
//   - Y-group (band) structure
//   - Fullscreen transitions and container-driven sizing
//
// The plane does NOT own:
//   - Selection state (see Selection / ChartSelection)
//   - Interaction (see InteractionLayer)
//   - Any specific layer rendering
// ──────────────────────────────────────────────────────────────

import { SVG } from './SVG.js';
import { CSS } from './CSS.js';
import { Utils } from './Utils.js';
import { Scale } from './Scale.js';
import { Events, EventEmitter } from './Events.js';

const css = CSS.cartesianPlane;

// ─── Layout constants ───
const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 400;

// ─── Band resize ───
const DEFAULT_MIN_BAND_HEIGHT = 40;
const DEFAULT_HANDLE_HIT_HEIGHT = 5;

// ─── Resize debounce (ms) ───
const RESIZE_DEBOUNCE_MS = 100;

// ─── Slot rank for render ordering ───
const SLOT_RANK = {
	'plot-area': 0,
	'band': 1,
	'grid': 2,
	'annotations': 3,
	'overlay': 4,
	'margin': 5,
	'html-overlay': 6
};

export class CartesianPlane {
	constructor(o = {}) {
		// ─── IDENTITY ───
		this.id = o.id || Utils.uniqueId('plane-');
		this.width = o.width || DEFAULT_WIDTH;
		this.height = o.height || DEFAULT_HEIGHT;

		// ─── MARGINS ───
		this.margins = o.margins || { top: 0, right: 0, bottom: 0, left: 0 };

		// ─── SCALES ───
		this.xScale = o.xScale || new Scale({
			domain: o.xDomain || [0, 1],
			range: [0, this.width],
			type: o.xScaleType || 'time',
			nice: true,
			space: 'cartesian'
		});

		this.yScale = o.yScale || new Scale({
			domain: o.yDomain || [0, 1],
			range: [this.height, 0],
			type: o.yScaleType || 'linear',
			nice: true,
			space: 'cartesian'
		});

		// ─── DOMAIN STRATEGY ───
		this.domainStrategy = o.domainStrategy || 'static';
		this._windowSize = o.windowSize || this.width;
		this.autoAdjustY = o.autoAdjustY !== undefined ? o.autoAdjustY : true;

		// ─── CLIPPING ───
		this.clipArea = this._normalizeClipArea(o.clipArea);

		// ─── BAND RESIZE ───
		this.resizableBands = this._normalizeResizableBands(o.resizableBands);
		this.minBandHeight = o.minBandHeight || DEFAULT_MIN_BAND_HEIGHT;
		this.handleHitHeight = o.handleHitHeight || DEFAULT_HANDLE_HIT_HEIGHT;

		// ─── LAYERS ───
		this._layers = Object.create(null);
		this._layerIds = [];
		this._layersNeedingRender = Object.create(null);
		this._marginRequesters = [];
		this._dataLayers = [];
		this._yGroups = Object.create(null);
		this._yGroupOrder = [];
		this._clipRects = Object.create(null);
		this._clipPaths = Object.create(null);

		// ─── DOM ELEMENTS ───
		this._elements = {
			container: null,
			svg: null,
			defs: null,
			rootGroup: null,
			htmlOverlay: null,
			marginTop: null,
			marginBottom: null,
			marginLeft: null,
			marginRight: null,
			plotArea: null,
			plotBg: null,
			grid: null,
			bands: null,
			handles: null,
			annotations: null,
			overlay: null,
			bandGroups: Object.create(null)
		};

		// ─── EVENTS ───
		this.events = new EventEmitter();
		this.onUpdate = o.onUpdate || null;
		this.onMount = o.onMount || null;
		this.onLayerAdd = o.onLayerAdd || null;
		this.onLayerRemove = o.onLayerRemove || null;

		// ─── STATE ───
		this._marginDirty = true;
		this._domainDirty = true;
		this._layoutDirty = true;
		this._decimalsDirty = true;
		this._windowDirty = false;
		this._updateCount = 0;
		this._plotAreaCache = null;

		// ─── INTERACTION ───
		this.interactionMode = o.interactionMode || 'pan';
		this._xDomainLocked = false;
		this._yDomainLocked = Object.create(null);

		// ─── BATCHING ───
		this._updatePending = false;
		this._rafId = null;

		// ─── FULLSCREEN / RESIZE ───
		this._fullscreenTransitioning = false;
		this._resizeTimer = null;
		this._onFullscreenChange = this._onFullscreenChange.bind(this);
		this._onWindowResize = this._onWindowResize.bind(this);

		// ─── PRECOMPUTED CLASS STRINGS ───
		this._handlesClass = this._computeHandlesClass();
	}

	// ──────────────────────────────────────────────────────────
	// PRECOMPUTED CLASS STRINGS
	// ──────────────────────────────────────────────────────────

	_computeHandlesClass() {
		let variant;
		switch (this.resizableBands) {
			case 'none': variant = css.handlesNone; break;
			case 'always': variant = css.handlesAlways; break;
			default: variant = css.handlesOnHover;
		}
		return `${css.handles} ${variant}`;
	}

	// ──────────────────────────────────────────────────────────
	// CLIPPING
	// ──────────────────────────────────────────────────────────

	/**
	 * Normalizes the various accepted forms of the clipArea option into a
	 * consistent `{ area, ghost, line, points }` object.
	 *
	 * @param {boolean|object|null|undefined} value
	 * @returns {{ area: boolean, ghost: boolean, line: boolean, points: boolean }}
	 */
	_normalizeClipArea(value) {
		const defaults = { area: true, ghost: false, line: true, points: true };
		if (value === undefined || value === null) return { ...defaults };
		if (value === true) return { ...defaults };
		if (value === false) return { area: false, ghost: false, line: false, points: false };
		return { ...defaults, ...value };
	}

	/**
	 * Returns the DOM id of the clipPath registered for the given y-group,
	 * or null if no clip path exists for that group.
	 *
	 * @param {string} groupId
	 * @returns {string|null}
	 */
	getClipPathId(groupId) {
		return this._clipPaths[groupId] ? `${this.id}-clip-${groupId}` : null;
	}

	// ──────────────────────────────────────────────────────────
	// BAND RESIZE
	// ──────────────────────────────────────────────────────────

	/**
	 * Normalizes the resizableBands option into one of 'none', 'onHover', 'always'.
	 *
	 * @param {boolean|string|null|undefined} value
	 * @returns {'none'|'onHover'|'always'}
	 */
	_normalizeResizableBands(value) {
		if (value === undefined || value === null) return 'onHover';
		if (value === true) return 'onHover';
		if (value === false) return 'none';
		if (value === 'always' || value === 'onHover' || value === 'none') return value;
		return 'onHover';
	}

	/**
	 * Ensures the handles group has exactly one hit-target per adjacent
	 * pair of populated bands and positions each at the shared boundary.
	 */
	_updateBandHandles() {
		if (this.resizableBands === 'none') return;

		const handlesGroup = this._elements.handles;
		if (!handlesGroup) return;

		const yGroups = this._yGroups;
		const yGroupOrder = this._yGroupOrder;

		const groups = [];
		for (let i = 0, len = yGroupOrder.length; i < len; i++) {
			const g = yGroups[yGroupOrder[i]];
			if (g && g.rows.length > 0) groups.push(g);
		}

		const sorted = groups.slice().sort((a, b) => a._yTop - b._yTop);
		const desiredCount = Math.max(0, sorted.length - 1);

		while (handlesGroup.children.length < desiredCount) {
			const rect = SVG.create('rect', {
				class: css.handle,
				x: 0, y: 0, width: 0, height: this.handleHitHeight
			});
			SVG.append(handlesGroup, rect);
		}
		while (handlesGroup.children.length > desiredCount) {
			handlesGroup.removeChild(handlesGroup.lastChild);
		}

		const plotLeft = this.plotLeft;
		const plotWidth = this.plotWidth;
		const handleHitHeight = this.handleHitHeight;

		for (let i = 0; i < desiredCount; i++) {
			const upper = sorted[i];
			const lower = sorted[i + 1];
			const handleY = upper._yBottom;
			const rect = handlesGroup.children[i];

			SVG.set(rect, {
				x: plotLeft,
				y: handleY - handleHitHeight / 2,
				width: plotWidth,
				height: handleHitHeight,
				'data-upper': upper.id,
				'data-lower': lower.id
			});

			if (!rect._bound) {
				this._bindBandHandleDrag(rect);
				rect._bound = true;
			}
		}
	}

	/**
	 * Attaches mousedown/mousemove/mouseup handlers to a handle rect so
	 * dragging it resizes the two adjacent bands proportionally.
	 *
	 * @param {SVGElement} handleEl
	 */
	_bindBandHandleDrag(handleEl) {
		handleEl.addEventListener('mousedown', (e) => {
			if (e.button !== 0) return;

			const upperId = handleEl.getAttribute('data-upper');
			const lowerId = handleEl.getAttribute('data-lower');
			const yGroups = this._yGroups;
			const upper = yGroups[upperId];
			const lower = yGroups[lowerId];
			if (!upper || !lower) return;

			e.preventDefault();
			e.stopPropagation();

			const svg = this._elements.svg;
			const svgPoint = SVG.getPoint(svg,e);
			if (!svgPoint) return;

			const startY = svgPoint.y;
			const startUpperH = upper._heightPx;
			const startLowerH = lower._heightPx;
			const totalH = startUpperH + startLowerH;
			const minH = this.minBandHeight;
			const plotHeight = this.plotHeight;

			const onMove = (ev) => {
				const pt = SVG.getPoint(svg, ev);
				if (!pt) return;

				const dy = pt.y - startY;

				let newUpperH = startUpperH + dy;
				let newLowerH = totalH - newUpperH;

				if (newUpperH < minH) {
					newUpperH = minH;
					newLowerH = totalH - minH;
				}
				if (newLowerH < minH) {
					newLowerH = minH;
					newUpperH = totalH - minH;
				}

				upper._userHeight = newUpperH / plotHeight;
				lower._userHeight = newLowerH / plotHeight;

				this._layoutDirty = true;
				this._requestUpdate();
			};

			const onUp = () => {
				window.removeEventListener('mousemove', onMove);
				window.removeEventListener('mouseup', onUp);
			};

			window.addEventListener('mousemove', onMove);
			window.addEventListener('mouseup', onUp);
		});
	}

	/**
	 * Clears all per-group user-defined heights so the next layout pass
	 * distributes bands by their declared heights.
	 *
	 * @returns {CartesianPlane} this
	 */
	resetBandHeights() {
		const yGroups = this._yGroups;
		for (const gid in yGroups) {
			delete yGroups[gid]._userHeight;
		}
		this._layoutDirty = true;
		this._requestUpdate();
		return this;
	}

	// ──────────────────────────────────────────────────────────
	// WINDOW SIZE
	// ──────────────────────────────────────────────────────────

	get windowSize() { return this._windowSize; }

	/**
	 * Updates the sliding-window size in x-units. Notifies every data
	 * layer so they can trim their tails, then schedules an update.
	 */
	set windowSize(value) {
		if (value === this._windowSize) return;
		if (!isFinite(value) || value <= 0) {
			throw new Error('windowSize must be a positive finite number');
		}
		this._windowSize = value;
		this._windowDirty = true;
		this._domainDirty = true;

		const layers = this._layers;
		for (const id in layers) {
			const layer = layers[id].instance;
			if (layer.isDataLayer && typeof layer.setWindowSize === 'function') {
				layer.setWindowSize(value);
			}
		}

		this._requestUpdate();
	}

	// ──────────────────────────────────────────────────────────
	// PLOT AREA
	// ──────────────────────────────────────────────────────────

	get plotLeft() { return this.margins.left; }
	get plotRight() { return this.width - this.margins.right; }
	get plotTop() { return this.margins.top; }
	get plotBottom() { return this.height - this.margins.bottom; }
	get plotWidth() { return this.plotRight - this.plotLeft; }
	get plotHeight() { return this.plotBottom - this.plotTop; }

	/**
	* Returns the plot rectangle. The returned object is shared and
	* reused across calls — read fields synchronously; do not retain.
 	*/
	getPlotArea() {
		if (this._plotAreaCache !== null) return this._plotAreaCache;

		const left = this.margins.left;
		const right = this.width - this.margins.right;
		const top = this.margins.top;
		const bottom = this.height - this.margins.bottom;

		this._plotAreaCache = {
			left, right, top, bottom,
			width: right - left,
			height: bottom - top
		};
		return this._plotAreaCache;
	}

	/**
	 * Returns the DOM element that receives pointer events for the plane.
	 * Selection domains and interaction handlers should attach their
	 * listeners to this element rather than reaching into the plane's
	 * internal DOM.
	 *
	 * @returns {SVGElement|null}
	 */
	getHitElement() {
		return this._elements ? this._elements.svg : null;
	}

	// ──────────────────────────────────────────────────────────
	// LAYER MANAGEMENT
	// ──────────────────────────────────────────────────────────

	/**
	 * Returns the layer instances currently registered with the plane,
	 * in registration order.
	 *
	 * @returns {Array<object>}
	 */
	getLayers() {
		const ids = this._layerIds;
		const layers = this._layers;
		const result = new Array(ids.length);
		for (let i = 0, len = ids.length; i < len; i++) {
			result[i] = layers[ids[i]].instance;
		}
		return result;
	}

	/**
	 * Returns the layer instance registered under the given id, or null.
	 *
	 * @param {string} id
	 * @returns {object|null}
	 */
	getLayer(id) {
		const entry = this._layers[id];
		return entry ? entry.instance : null;
	}

	/**
	 * Resolves which margin `<g>` a layer should render into, based on
	 * its orientation or position property.
	 *
	 * @param {object} layer
	 * @returns {SVGElement}
	 */
	_getMarginSlot(layer) {
		const key = layer.orientation || layer.position || 'bottom';
		const el = this._elements;
		switch (key) {
			case 'top': return el.marginTop;
			case 'bottom': return el.marginBottom;
			case 'left': return el.marginLeft;
			case 'right': return el.marginRight;
			default: return el.marginBottom;
		}
	}

	/**
	 * Resolves the DOM container a layer should render into, based on its
	 * `slot` property. Falls back to the plot area group for unknown slots.
	 *
	 * @param {object} layer
	 * @returns {SVGElement}
	 */
	_getSlotForLayer(layer) {
		const el = this._elements;
		switch (layer.slot) {
			case 'margin':
				return this._getMarginSlot(layer);
			case 'band': {
				const gid = layer._yGroupId;
				if (gid && el.bandGroups[gid]) return el.bandGroups[gid];
				return el.plotArea;
			}
			case 'annotations': return el.annotations;
			case 'overlay': return el.overlay;
			case 'html-overlay': return el.htmlOverlay;
			case 'grid': return el.grid;
			case 'plot-area':
			default: return el.plotArea;
		}
	}

	/**
	 * Computes the order in which layers should be rendered this pass.
	 * Layers are grouped by slot (in fixed DOM order), then sorted by z
	 * ascending, with insertion order as the tiebreaker.
	 *
	 * @param {string[]} ids
	 * @returns {string[]}
	 */
	_computeRenderOrder(ids) {
		const layers = this._layers;
		const indexed = new Array(ids.length);

		for (let i = 0, len = ids.length; i < len; i++) {
			const id = ids[i];
			const entry = layers[id];
			const layer = entry ? entry.instance : null;
			const slot = layer ? layer.slot : null;
			indexed[i] = {
				id,
				insertionIndex: i,
				slotRank: slot !== null && SLOT_RANK[slot] !== undefined ? SLOT_RANK[slot] : 99,
				z: layer && isFinite(layer.z) ? layer.z : 0
			};
		}

		indexed.sort((a, b) => {
			if (a.slotRank !== b.slotRank) return a.slotRank - b.slotRank;
			if (a.z !== b.z) return a.z - b.z;
			return a.insertionIndex - b.insertionIndex;
		});

		const ordered = new Array(indexed.length);
		for (let i = 0; i < indexed.length; i++) ordered[i] = indexed[i].id;
		return ordered;
	}

	/**
	 * Registers a layer with the plane and schedules a render pass.
	 *
	 * Idempotent: if the layer is already registered, this is a no-op.
	 * Safe to call after removeLayer() to re-attach a detached layer.
	 *
	 * @param {object} layer
	 * @param {object} [options]
	 * @returns {string} The layer's id
	 */
	addLayer(layer, options = {}) {
		if (!layer || typeof layer.render !== 'function') {
			throw new Error('Layer must have a render() method');
		}

		layer.plane = this;
		const id = layer.id || Utils.uniqueId('layer-');
		layer.id = id;
		const type = layer.type || options.type || 'unknown';

		if (this._layers[id]) return id;

		layer._addOptions = options;

		if (layer.isDataLayer) {
			const groupId = options.yGroup || options.group || 'default';
			const height = options.height || options.rowHeight || 0.3;
			this._addToYGroup(groupId, layer, height);
			this._decimalsDirty = true;
			if (typeof layer.setWindowSize === 'function') {
				layer.setWindowSize(this._windowSize);
			}
		}

		const hasMarginRequest = typeof layer.getMarginRequest === 'function';
		const marginRequest = hasMarginRequest ? layer.getMarginRequest() : null;

		this._layers[id] = {
			id, instance: layer, group: null, type,
			meta: options.meta || {},
			createdAt: Date.now(),
			hasMarginRequest,
			marginRequest: marginRequest || null,
			needsMargin: !!marginRequest,
			rendered: false
		};
		this._layerIds.push(id);
		this._layersNeedingRender[id] = true;
		if (hasMarginRequest) this._marginRequesters.push(id);
		if (layer.isDataLayer) this._dataLayers.push(id);

		this._marginDirty = true;
		this._domainDirty = true;
		this._layoutDirty = true;

		this.events.emit(Events.LAYER_ADDED, { layer, id, options, type, hasMarginRequest, marginRequest });
		this.events.emit(Events.LAYOUT_CHANGED, { plane: this, reason: 'layer_added', layerId: id });
		if (this.onLayerAdd) this.onLayerAdd(id, layer, options);

		this._requestUpdate();
		return id;
	}

	/**
	 * Detaches a layer from the plane. Removes its DOM, its y-group row
	 * (and the y-group itself if now empty), its clip path, its registry
	 * entries, and any active plane-event subscriptions. Sets
	 * `layer.plane = null` and does NOT call `layer.destroy()`.
	 *
	 * @param {object|string} layer
	 * @returns {CartesianPlane} this
	 */
	removeLayer(layer) {
		const id = typeof layer === 'string' ? layer : layer.id;
		if (!id || !this._layers[id]) return this;

		const entry = this._layers[id];
		const instance = entry.instance;

		this.events.emit(Events.LAYER_WILL_REMOVE, { layer: instance, id });

		if (entry.group && entry.group.parentNode) {
			entry.group.parentNode.removeChild(entry.group);
		}

		if (typeof instance._unsubscribeFromPlaneEvents === 'function') {
			instance._unsubscribeFromPlaneEvents();
		}

		if (instance.isDataLayer && instance._yGroupId) {
			const groupId = instance._yGroupId;
			this._removeFromYGroup(groupId, instance);
			const group = this._yGroups[groupId];
			if (group && group.rows.length === 0) {
				this.removeBandGroup(groupId);
			}
		}

		delete this._layers[id];
		delete this._layersNeedingRender[id];
		const mri = this._marginRequesters.indexOf(id);
		if (mri !== -1) this._marginRequesters.splice(mri, 1);
		const dli = this._dataLayers.indexOf(id);
		if (dli !== -1) this._dataLayers.splice(dli, 1);

		const idx = this._layerIds.indexOf(id);
		if (idx !== -1) this._layerIds.splice(idx, 1);

		instance.plane = null;

		this._marginDirty = true;
		this._domainDirty = true;
		this._layoutDirty = true;
		this._decimalsDirty = true;

		this.events.emit(Events.LAYER_REMOVED, { layer: instance, id });
		this.events.emit(Events.LAYOUT_CHANGED, { plane: this, reason: 'layer_removed', layerId: id });
		if (this.onLayerRemove) this.onLayerRemove(id, instance);

		this._requestUpdate();
		return this;
	}

	/**
	 * Permanently tears down every layer on the plane. Unlike
	 * removeLayer(), this calls `layer.destroy()` on each instance.
	 *
	 * @returns {CartesianPlane} this
	 */
	clearLayers() {
		const ids = this._layerIds;
		const layers = this._layers;
		for (let i = 0, len = ids.length; i < len; i++) {
			const entry = layers[ids[i]];
			if (entry) {
				if (entry.group && entry.group.parentNode) entry.group.parentNode.removeChild(entry.group);
				if (entry.instance && typeof entry.instance.destroy === 'function') entry.instance.destroy();
			}
		}
		this._layers = Object.create(null);
		this._layerIds = [];
		this._layersNeedingRender = Object.create(null);
		this._marginRequesters = [];
		this._dataLayers = [];
		this._yGroups = Object.create(null);
		this._yGroupOrder = [];

		const bandGroups = this._elements.bandGroups;
		for (const gid in bandGroups) {
			const el = bandGroups[gid];
			if (el && el.parentNode) el.parentNode.removeChild(el);
			delete bandGroups[gid];
		}

		if (this._elements.defs) {
			while (this._elements.defs.firstChild) {
				this._elements.defs.removeChild(this._elements.defs.firstChild);
			}
		}
		this._clipRects = Object.create(null);
		this._clipPaths = Object.create(null);

		this._marginDirty = true;
		this._domainDirty = true;
		this._layoutDirty = true;
		this._decimalsDirty = true;
		this.events.emit(Events.LAYOUT_CHANGED, { plane: this, reason: 'layers_cleared' });
		this._requestUpdate();
		return this;
	}

	// ──────────────────────────────────────────────────────────
	// Y-GROUP MANAGEMENT
	// ──────────────────────────────────────────────────────────

	/**
	 * Registers a chart into the named y-group, creating the group first
	 * if it doesn't exist. If the chart is already a row in the group,
	 * its height is updated in place.
	 *
	 * @param {string} groupId
	 * @param {object} chart
	 * @param {number} height
	 */
	_addToYGroup(groupId, chart, height) {
		let group = this._yGroups[groupId];
		if (!group) {
			group = {
				id: groupId, height, rows: [], yScale: null,
				domain: [0, 1], _yTop: 0, _yBottom: 0,
				_yRange: [0, 0], _heightPx: 0, _heightFraction: 0,
				_normalizedHeight: height, dirty: true, _createdAt: Date.now()
			};
			this._yGroups[groupId] = group;
			this._yGroupOrder.push(groupId);
			this.addBandGroup(groupId);
		}

		chart._yGroupId = groupId;
		chart._rowHeight = height;

		const existing = group.rows.find(r => r.chart === chart);
		if (existing) {
			existing.height = height;
			existing.dirty = true;
		} else {
			group.rows.push({ chart, height, dirty: true });
		}

		this._layoutDirty = true;
		this._domainDirty = true;
		this._decimalsDirty = true;
	}

	/**
	 * Removes a chart's row from its y-group. Does not remove the group.
	 *
	 * @param {string} groupId
	 * @param {object} chart
	 */
	_removeFromYGroup(groupId, chart) {
		const group = this._yGroups[groupId];
		if (!group) return;
		const idx = group.rows.findIndex(r => r.chart.id === chart.id);
		if (idx !== -1) {
			group.rows.splice(idx, 1);
			group.dirty = true;
		}
	}

	/**
	 * Creates the DOM structure for a y-group: a band `<g>` inside the
	 * bands slot, a background rect inside it, and a clipPath in defs if
	 * any element type needs clipping.
	 *
	 * @param {string} groupId
	 */
	addBandGroup(groupId) {
		const bandsSlot = this._elements.bands;
		if (!bandsSlot) return;

		const clip = this.clipArea;
		const needsClip = clip.area || clip.ghost || clip.line || clip.points;

		if (needsClip) {
			const clipPath = SVG.create('clipPath', {
				id: `${this.id}-clip-${groupId}`
			});
			const clipRect = SVG.create('rect', {
				id: `${this.id}-clip-${groupId}-rect`,
				x: 0, y: 0, width: 0, height: 0
			});
			SVG.append(clipPath, clipRect);
			SVG.append(this._elements.defs, clipPath);

			this._clipRects[groupId] = clipRect;
			this._clipPaths[groupId] = clipPath;
		}

		const band = SVG.create('g', {
			id: `${this.id}-band-${groupId}`,
			class: css.band,
			'data-group': groupId
		});
		SVG.append(bandsSlot, band);

		const bg = SVG.create('rect', {
			id: `${this.id}-band-${groupId}-bg`,
			class: css.bandBackground,
			x: 0, y: 0, width: 0, height: 0
		});
		SVG.append(band, bg);

		this._elements.bandGroups[groupId] = band;
	}

	/**
	 * Tears down a y-group's DOM and deregisters it.
	 *
	 * @param {string} groupId
	 */
	removeBandGroup(groupId) {
		const group = this._yGroups[groupId];
		if (!group) return;

		const bandEl = this._elements.bandGroups[groupId];
		if (bandEl && bandEl.parentNode) bandEl.parentNode.removeChild(bandEl);
		delete this._elements.bandGroups[groupId];

		const clipPath = this._clipPaths[groupId];
		if (clipPath && clipPath.parentNode) clipPath.parentNode.removeChild(clipPath);
		delete this._clipRects[groupId];
		delete this._clipPaths[groupId];

		delete this._yGroups[groupId];
		const orderIdx = this._yGroupOrder.indexOf(groupId);
		if (orderIdx !== -1) this._yGroupOrder.splice(orderIdx, 1);

		this._layoutDirty = true;
		this._domainDirty = true;
		this._decimalsDirty = true;
	}

	/**
	 * Returns the y-scale for a chart's y-group, creating a default
	 * scale if the chart isn't assigned to a group.
	 *
	 * @param {object} chart
	 * @returns {Scale}
	 */
	getYScaleForChart(chart) {
		const groupId = chart._yGroupId;
		if (!groupId || !this._yGroups[groupId]) {
			if (!this._defaultYScale) {
				this._defaultYScale = new Scale({
					domain: [0, 1],
					range: [this.plotBottom, this.plotTop],
					type: 'linear', nice: true, space: 'svg'
				});
			}
			return this._defaultYScale;
		}
		const group = this._yGroups[groupId];
		if (!group.yScale) {
			const range = group._yRange || [this.plotBottom, this.plotTop];
			group.yScale = new Scale({
				domain: [0, 1], range, type: 'linear', nice: true, space: 'svg'
			});
			group.dirty = true;
		}
		return group.yScale;
	}

	/**
	 * Returns the pixel bounds of a chart's y-group. Falls back to the
	 * full plot area if the chart isn't in a group.
	 *
	 * @param {object} chart
	 * @returns {{ top: number, bottom: number, left: number, right: number, height: number, width: number }}
	 */
	getBandBounds(chart) {
		const bounds = {
			top: this.plotTop, bottom: this.plotBottom,
			left: this.plotLeft, right: this.plotRight,
			height: this.plotHeight, width: this.plotWidth
		};
		if (chart._yGroupId && this._yGroups) {
			const group = this._yGroups[chart._yGroupId];
			if (group && group._yTop !== undefined && group._yBottom !== undefined) {
				bounds.top = group._yTop;
				bounds.bottom = group._yBottom;
				bounds.height = group._yBottom - group._yTop;
			}
		}
		return bounds;
	}

	/**
	 * Computes the decimal precision for each y-group from its member
	 * data layers' declared `decimals`.
	 */
	_computeYGroupDecimals() {
		const yGroups = this._yGroups;
		for (const groupId in yGroups) {
			const group = yGroups[groupId];
			if (group.rows.length === 0) {
				group.decimals = 2;
				continue;
			}

			let maxDecimals = 0;
			let hasDataLayer = false;
			const rows = group.rows;
			for (let i = 0, len = rows.length; i < len; i++) {
				const chart = rows[i].chart;
				if (!chart.isDataLayer) continue;
				hasDataLayer = true;
				const d = chart.decimals !== undefined ? chart.decimals : 2;
				if (d > maxDecimals) maxDecimals = d;
			}
			group.decimals = hasDataLayer ? maxDecimals : 2;
		}
	}

	// ──────────────────────────────────────────────────────────
	// DOMAIN CHANGE SIGNAL
	// ──────────────────────────────────────────────────────────

	/**
	 * Called by data layers when their stats have changed.
	 *
	 * @param {object} layer
	 */
	_onLayerStatsChanged(layer) {
		if (layer && layer.isDataLayer) {
			this._domainDirty = true;
		}
		this._requestUpdate();
	}

	// ──────────────────────────────────────────────────────────
	// BATCH UPDATE
	// ──────────────────────────────────────────────────────────

	/**
	 * Schedules a batched update on the next animation frame. Multiple
	 * calls within the same frame coalesce into a single _performUpdate.
	 */
	_requestUpdate() {
		if (this._updatePending) return;
		this._updatePending = true;

		if (this._rafId) {
			cancelAnimationFrame(this._rafId);
			this._rafId = null;
		}

		this._rafId = requestAnimationFrame(() => {
			this._rafId = null;
			this._updatePending = false;
			this._performUpdate();
		});
	}

	// ──────────────────────────────────────────────────────────
	// MOUNT
	// ──────────────────────────────────────────────────────────

	/**
	 * Creates the plane's DOM tree inside the given container and wires
	 * the plane-level listeners.
	 *
	 * @param {HTMLElement|string} container
	 * @returns {CartesianPlane} this
	 */
	mount(container) {
		if (typeof container === 'string') container = document.querySelector(container);
		if (!container) throw new Error('Container element not found');

		const { width, height, id } = this;

		const containerEl = document.createElement('div');
		containerEl.id = `${id}-container`;
		containerEl.className = css.container;
		container.appendChild(containerEl);
		this._elements.container = containerEl;

		const svg = SVG.create('svg', {
			id: `${id}-svg`,
			class: css.svg,
			width, height,
			viewBox: `0 0 ${width} ${height}`
		});
		containerEl.appendChild(svg);
		this._elements.svg = svg;

		this._elements.defs = SVG.create('defs', { id: `${id}-defs` });
		SVG.append(svg, this._elements.defs);

		this._elements.rootGroup = SVG.create('g', {
			id: `${id}-root`,
			class: css.rootGroup
		});
		SVG.append(svg, this._elements.rootGroup);

		// ─── Margins ───
		const rootGroup = this._elements.rootGroup;

		this._elements.marginTop = SVG.create('g', {
			id: `${id}-margin-top`,
			class: css.marginTop
		});
		SVG.append(rootGroup, this._elements.marginTop);

		this._elements.marginBottom = SVG.create('g', {
			id: `${id}-margin-bottom`,
			class: css.marginBottom
		});
		SVG.append(rootGroup, this._elements.marginBottom);

		this._elements.marginLeft = SVG.create('g', {
			id: `${id}-margin-left`,
			class: css.marginLeft
		});
		SVG.append(rootGroup, this._elements.marginLeft);

		this._elements.marginRight = SVG.create('g', {
			id: `${id}-margin-right`,
			class: css.marginRight
		});
		SVG.append(rootGroup, this._elements.marginRight);

		// ─── Plot area ───
		this._elements.plotArea = SVG.create('g', {
			id: `${id}-plot-area`,
			class: css.plotArea
		});
		SVG.append(rootGroup, this._elements.plotArea);

		const plotArea = this._elements.plotArea;

		this._elements.plotBg = SVG.create('rect', {
			id: `${id}-plot-bg`,
			class: css.plotBg,
			x: 0, y: 0, width: 0, height: 0
		});
		SVG.append(plotArea, this._elements.plotBg);

		this._elements.grid = SVG.create('g', {
			id: `${id}-grid`,
			class: css.grid
		});
		SVG.append(plotArea, this._elements.grid);

		this._elements.bands = SVG.create('g', {
			id: `${id}-bands`,
			class: css.bands
		});
		SVG.append(plotArea, this._elements.bands);

		this._elements.handles = SVG.create('g', {
			id: `${id}-handles`,
			class: this._handlesClass
		});
		SVG.append(plotArea, this._elements.handles);

		this._elements.annotations = SVG.create('g', {
			id: `${id}-annotations`,
			class: css.annotations
		});
		SVG.append(plotArea, this._elements.annotations);

		this._elements.overlay = SVG.create('g', {
			id: `${id}-overlay`,
			class: css.overlay
		});
		SVG.append(rootGroup, this._elements.overlay);

		// ─── HTML overlay (sibling of the SVG) ───
		const htmlOverlay = document.createElement('div');
		htmlOverlay.id = `${id}-html-overlay`;
		htmlOverlay.className = css.htmlOverlay;
		containerEl.appendChild(htmlOverlay);
		this._elements.htmlOverlay = htmlOverlay;

		// ─── Listeners ───
		document.addEventListener('fullscreenchange', this._onFullscreenChange);
		window.addEventListener('resize', this._onWindowResize);

		// Adopt the container's actual size before first render.
		const rect = containerEl.getBoundingClientRect();
		if (rect.width > 0 && rect.height > 0) {
			this.width = rect.width;
			this.height = rect.height;
			SVG.set(svg, {
				width: this.width, height: this.height,
				viewBox: `0 0 ${this.width} ${this.height}`
			});
		}

		this._marginDirty = true;
		this._domainDirty = true;
		this._layoutDirty = true;
		this._decimalsDirty = true;

		this.events.emit(Events.PLANE_MOUNTED, { plane: this });
		if (this.onMount) this.onMount(this);
		this._requestUpdate();
		return this;
	}

	// ──────────────────────────────────────────────────────────
	// RESIZE / FULLSCREEN
	// ──────────────────────────────────────────────────────────

	/**
	 * Resizes the plane's SVG and viewBox. No-op if unchanged.
	 *
	 * @param {number} width
	 * @param {number} height
	 * @returns {CartesianPlane} this
	 */
	resize(width, height) {
		const w = width || this.width;
		const h = height || this.height;
		if (w === this.width && h === this.height) return this;

		this.width = w;
		this.height = h;
		this._plotAreaCache = null;
		if (this._elements.svg) {
			SVG.set(this._elements.svg, {
				width: w, height: h,
				viewBox: `0 0 ${w} ${h}`
			});
		}
		this._marginDirty = true;
		this._layoutDirty = true;
		this._requestUpdate();
		this.events.emit(Events.PLANE_RESIZED, { plane: this, width: w, height: h });
		return this;
	}

	/**
	 * Requests browser fullscreen for the plane's container.
	 *
	 * @returns {Promise<void>}
	 */
	async requestFullscreen() {
		const container = this._elements.container;
		if (!container) return;
		if (!container.requestFullscreen) {
			console.warn('Fullscreen API not supported in this browser');
			return;
		}
		try {
			await container.requestFullscreen();
		} catch (e) {
			console.warn('Failed to enter fullscreen:', e.message || e);
		}
	}

	/**
	 * Exits fullscreen if this plane's container is the fullscreen element.
	 *
	 * @returns {Promise<void>}
	 */
	async exitFullscreen() {
		const container = this._elements.container;
		if (!container) return;
		if (document.fullscreenElement !== container) return;
		try {
			await document.exitFullscreen();
		} catch (e) {
			console.warn('Failed to exit fullscreen:', e.message || e);
		}
	}

	/**
	 * Toggles fullscreen state. Guarded against rapid toggling.
	 *
	 * @returns {Promise<void>}
	 */
	toggleFullscreen() {
		if (this._fullscreenTransitioning) return Promise.resolve();
		this._fullscreenTransitioning = true;
		const promise = this.isFullscreen()
			? this.exitFullscreen()
			: this.requestFullscreen();
		promise.finally(() => { this._fullscreenTransitioning = false; });
		return promise;
	}

	/** @returns {boolean} */
	isFullscreen() {
		return document.fullscreenElement === this._elements.container;
	}

	/**
	 * Measures the container and resizes the plane to match.
	 */
	_syncSizeToContainer() {
		const container = this._elements.container;
		if (!container) return;
		const rect = container.getBoundingClientRect();
		if (rect.width > 0 && rect.height > 0) {
			this.resize(rect.width, rect.height);
		}
	}

	_onFullscreenChange() {
		const container = this._elements.container;
		if (!container) return;

		const entering = document.fullscreenElement === container;

		clearTimeout(this._resizeTimer);
		this._resizeTimer = setTimeout(() => this._syncSizeToContainer(), RESIZE_DEBOUNCE_MS);

		this.events.emit(Events.FULLSCREEN_CHANGED, {
			plane: this,
			fullscreen: entering,
			width: this.width,
			height: this.height
		});
	}

	_onWindowResize() {
		clearTimeout(this._resizeTimer);
		this._resizeTimer = setTimeout(() => this._syncSizeToContainer(), RESIZE_DEBOUNCE_MS);
	}

	// ──────────────────────────────────────────────────────────
	// DESTROY
	// ──────────────────────────────────────────────────────────

	destroy() {
		document.removeEventListener('fullscreenchange', this._onFullscreenChange);
		window.removeEventListener('resize', this._onWindowResize);

		if (this._resizeTimer) {
			clearTimeout(this._resizeTimer);
			this._resizeTimer = null;
		}
		if (this._rafId) {
			cancelAnimationFrame(this._rafId);
			this._rafId = null;
		}

		this.clearLayers();

		const svg = this._elements.svg;
		if (svg && svg.parentNode) svg.parentNode.removeChild(svg);

		const container = this._elements.container;
		if (container && container.parentNode) container.parentNode.removeChild(container);

		this._elements = {};
		this._plotAreaCache = null;
		this._clipRects = Object.create(null);
		this._clipPaths = Object.create(null);
		this.onUpdate = null;
		this.onMount = null;
		this.onLayerAdd = null;
		this.onLayerRemove = null;
		this.events.emit(Events.PLANE_DESTROYED, { plane: this });
		this.events.off();
	}

	/**
	 * Marks the margin computation as stale and schedules a pass.
	 *
	 * @returns {CartesianPlane} this
	 */
	markMarginsDirty() {
		this._marginDirty = true;
		this.events.emit(Events.LAYOUT_CHANGED, { plane: this, reason: 'margins_dirty' });
		this._requestUpdate();
		return this;
	}

	// ──────────────────────────────────────────────────────────
	// LAYOUT COMPUTATION
	// ──────────────────────────────────────────────────────────

	/**
	 * Walks every layer's getMarginRequest() and computes the union of
	 * all requested margins.
	 *
	 * @returns {boolean} Whether the margins actually changed
	 */
	_recalculateAllMargins() {
		let top = 0, bottom = 0, left = 0, right = 0;
		const index = this._marginRequesters;
		const layers = this._layers;

		for (let i = 0, len = index.length; i < len; i++) {
			const entry = layers[index[i]];
			if (!entry) continue;
			const layer = entry.instance;
			if (typeof layer.getMarginRequest !== 'function') continue;
			const req = layer.getMarginRequest();
			if (req) {
				if (req.top > top) top = req.top;
				if (req.bottom > bottom) bottom = req.bottom;
				if (req.left > left) left = req.left;
				if (req.right > right) right = req.right;
			}
		}

		const old = this.margins;
		const changed = old.top !== top || old.bottom !== bottom ||
			old.left !== left || old.right !== right;

		if (changed) {
			this._plotAreaCache = null;
			this.margins = { top, bottom, left, right };
			this._layoutDirty = true;
			this.events.emit(Events.MARGINS_CHANGED, {
				plane: this,
				margins: this.margins,
				oldMargins: { ...old }
			});
		}
		return changed;
	}

	/**
	 * Distributes the plot area's vertical space among populated y-groups
	 * and updates each band's background and clip rect. Emits
	 * YGROUP_DOMAIN_CHANGED per group.
	 */
	_computeYGroupLayout() {
		const plotHeight = this.plotHeight;
		if (plotHeight <= 0) return;

		const yGroups = this._yGroups;
		const yGroupOrder = this._yGroupOrder;

		const groups = [];
		for (let i = 0, len = yGroupOrder.length; i < len; i++) {
			const group = yGroups[yGroupOrder[i]];
			if (group && group.rows.length > 0) groups.push(group);
		}
		if (groups.length === 0) return;

		let total = 0;
		for (let i = 0, len = groups.length; i < len; i++) {
			const group = groups[i];
			let h = group._userHeight !== undefined
				? group._userHeight
				: (group.rows[0] ? group.rows[0].height : (group.height || 0.3));
			if (!isFinite(h) || h <= 0) h = 0.3;
			group._normalizedHeight = h;
			total += h;
		}

		const scale = 1 / total;
		let yOffset = this.plotBottom;

		const plotLeft = this.plotLeft;
		const plotWidth = this.plotWidth;
		const bandGroups = this._elements.bandGroups;
		const clipRects = this._clipRects;

		for (let i = 0, len = groups.length; i < len; i++) {
			const group = groups[i];
			const heightFraction = group._normalizedHeight * scale;
			const rowHeight = plotHeight * heightFraction;
			const yTop = yOffset - rowHeight;

			group._yTop = yTop;
			group._yBottom = yOffset;
			group._yRange = [yOffset, yTop];
			group._heightPx = rowHeight;
			group._heightFraction = heightFraction;
			yOffset = yTop;

			const bandEl = bandGroups[group.id];
			if (bandEl) {
				const bg = bandEl.firstChild;
				if (bg) {
					SVG.set(bg, {
						x: plotLeft, y: yTop,
						width: plotWidth, height: rowHeight
					});
				}
			}

			const clipRect = clipRects[group.id];
			if (clipRect) {
				SVG.set(clipRect, {
					x: plotLeft, y: yTop,
					width: plotWidth, height: rowHeight
				});
			}
		}

		this._updateBandHandles();

		const events = this.events;
		for (let i = 0, len = groups.length; i < len; i++) {
			const group = groups[i];
			events.emit(Events.YGROUP_DOMAIN_CHANGED, {
				groupId: group.id,
				domain: group.domain,
				yScale: group.yScale,
				yRange: group._yRange,
				bandBounds: {
					top: group._yTop,
					bottom: group._yBottom,
					height: group._heightPx
				}
			});
		}
	}

	/**
	 * Recomputes each y-group's y-domain from its member data layers'
	 * stats. Skips groups with no rows or locked domains.
	 */
	_computeYGroupDomains() {
		const domainChanges = [];
		const yGroups = this._yGroups;
		const locked = this._yDomainLocked;
		const plotBottom = this.plotBottom;
		const plotTop = this.plotTop;

		for (const groupId in yGroups) {
			const group = yGroups[groupId];
			if (group.rows.length === 0) continue;
			if (locked[groupId]) continue;

			let yMin = Infinity, yMax = -Infinity;
			let hasData = false;
			const rows = group.rows;

			for (let i = 0, len = rows.length; i < len; i++) {
				const chart = rows[i].chart;
				if (!chart.isDataLayer) continue;
				const stats = chart.getStats();
				if (stats && stats.hasData) {
					hasData = true;
					if (stats.yMin < yMin) yMin = stats.yMin;
					if (stats.yMax > yMax) yMax = stats.yMax;
				}
			}

			if (!hasData) {
				group.domain = [0, 1];
				group.dirty = false;
				if (group.yScale) group.yScale.domain = [0, 1];
				continue;
			}

			group.domain = [yMin, yMax];
			group.dirty = false;

			const yRange = group._yRange || [plotBottom, plotTop];

			const bandBounds = {
				top: group._yTop !== undefined ? group._yTop : plotTop,
				bottom: group._yBottom !== undefined ? group._yBottom : plotBottom,
				height: (group._yBottom !== undefined ? group._yBottom : plotBottom) -
					(group._yTop !== undefined ? group._yTop : plotTop)
			};

			if (!group.yScale) {
				group.yScale = new Scale({
					domain: group.domain, range: yRange,
					type: group.type || 'linear', nice: false, space: 'svg'
				});
				domainChanges.push({
					groupId, domain: group.domain,
					yScale: group.yScale, yRange, bandBounds
				});
			} else {
				const oldD = group.yScale.domain;
				const newD = group.domain;
				if (oldD[0] !== newD[0] || oldD[1] !== newD[1]) {
					group.yScale.domain = newD;
					group.yScale.range = yRange;
					domainChanges.push({
						groupId, domain: newD,
						yScale: group.yScale, yRange, bandBounds
					});
				} else {
					group.yScale.range = yRange;
				}
			}
		}

		const events = this.events;
		for (let i = 0, len = domainChanges.length; i < len; i++) {
			events.emit(Events.YGROUP_DOMAIN_CHANGED, domainChanges[i]);
		}
	}

	/**
	 * Recomputes the plane's x-domain from all data layers' stats.
	 */
	_computeXDomain() {
		if (this._xDomainLocked) return;

		let xMin = Infinity, xMax = -Infinity;
		let hasData = false;

		const index = this._dataLayers;
		const layers = this._layers;

		for (let i = 0, len = index.length; i < len; i++) {
			const entry = layers[index[i]];
			if (!entry) continue;
			const layer = entry.instance;
			if (!layer.isDataLayer) continue;
			const stats = layer.getStats();
			if (stats && stats.hasData) {
				hasData = true;
				if (stats.xMin < xMin) xMin = stats.xMin;
				if (stats.xMax > xMax) xMax = stats.xMax;
			}
		}

		if (!hasData) { xMin = 0; xMax = 1; }

		let xDomain;
		switch (this.domainStrategy) {
			case 'sliding': {
				const maxX = xMax;
				const minX = Math.max(xMin, maxX - (this._windowSize || this.width));
				xDomain = [minX, maxX];
				break;
			}
			case 'expanding': {
				const range = xMax - xMin || 1;
				xDomain = [Math.max(0, xMin - range), xMax + range];
				break;
			}
			default:
				xDomain = this.xScale.domain;
				break;
		}

		const old = this.xScale.domain;
		if (old[0] !== xDomain[0] || old[1] !== xDomain[1]) {
			this.xScale.domain = xDomain;
			this.events.emit(Events.SCALE_DOMAIN_CHANGED, {
				plane: this, axis: 'x', domain: xDomain
			});
		}
	}

	/**
	 * Re-syncs the x-scale range to the current plot bounds and each
	 * y-group scale's range to its band's pixel range.
	 */
	_updateScaleRanges() {
		const plotLeft = this.plotLeft;
		const plotRight = this.plotRight;
		const xScale = this.xScale;
		const oldRange = xScale.range;

		xScale.range = [plotLeft, plotRight];

		if (oldRange[0] !== plotLeft || oldRange[1] !== plotRight) {
			this.events.emit(Events.SCALE_RANGE_CHANGED, {
				plane: this, xRange: [plotLeft, plotRight], oldXRange: oldRange
			});
		}

		const yGroups = this._yGroups;
		for (const groupId in yGroups) {
			const group = yGroups[groupId];
			if (group.yScale && group._yRange) {
				group.yScale.range = group._yRange;
			}
		}
	}

	/**
	 * Repositions the plot background rect.
	 */
	_updatePlotBg() {
		SVG.set(this._elements.plotBg, {
			x: this.plotLeft, y: this.plotTop,
			width: this.plotWidth, height: this.plotHeight
		});
	}

	// ──────────────────────────────────────────────────────────
	// PERFORM UPDATE
	// ──────────────────────────────────────────────────────────

	/**
	 * Runs a full update pass.
	 */
	_performUpdate() {
		if (this._marginDirty) {
			this._recalculateAllMargins();
			this._marginDirty = false;
		}

		if (this._layoutDirty) {
			this._computeYGroupLayout();
			this._layoutDirty = false;
		}

		this._updatePlotBg();
		this._computeXDomain();
		this._updateScaleRanges();

		if (this._domainDirty) {
			this._computeYGroupDomains();

			const marginsChanged = this._recalculateAllMargins();
			if (marginsChanged) {
				this._computeYGroupLayout();
				this._updateScaleRanges();
				this._updatePlotBg();
			}
			this._domainDirty = false;
		}

		if (this._decimalsDirty) {
			this._computeYGroupDecimals();
			this._decimalsDirty = false;
		}

		const layerIds = this._layerIds;
		const layers = this._layers;
		const needingRender = this._layersNeedingRender;
		const orderedIds = this._computeRenderOrder(layerIds);
		const xScale = this.xScale;

		for (let i = 0, len = orderedIds.length; i < len; i++) {
			const id = orderedIds[i];
			const entry = layers[id];
			if (!entry) continue;
			const layer = entry.instance;

			// Flag data layers dirty when their scales have changed.
			if (layer.isDataLayer) {
				const xD = xScale.domain;
				const xR = xScale.range;
				let key = xD[0] + ',' + xD[1] + '|' + xR[0] + ',' + xR[1];

				if (layer._yGroupId) {
					const yScale = this.getYScaleForChart(layer);
					if (yScale) {
						const yD = yScale.domain;
						const yR = yScale.range;
						key += '|' + yD[0] + ',' + yD[1] + '|' + yR[0] + ',' + yR[1];
						layer.yScale = yScale;
					}
				}

				if (layer._lastScaleKey !== key) {
					layer._lastScaleKey = key;
					layer._scaleDirty = true;
				}
			}

			if (needingRender[id]) {
				const slot = this._getSlotForLayer(layer);
				entry.group = layer.render(slot);
				if (entry.group) {
					entry.group.__cpLayerId = id;
				}
				delete needingRender[id];
				entry.rendered = true;
			}

			if (typeof layer.update === 'function') {
				layer.update();
			}
		}

		this._updateCount++;

		this.events.emit(Events.PLANE_UPDATED, {
			plane: this, updateCount: this._updateCount,
			layerCount: layerIds.length, margins: this.margins
		});

		if (this.onUpdate) {
			this.onUpdate({
				updateCount: this._updateCount,
				layerCount: layerIds.length,
				margins: this.margins
			});
		}
	}

	/**
	 * Runs a synchronous update pass. Prefer _requestUpdate() for batching.
	 *
	 * @returns {CartesianPlane} this
	 */
	update() {
		this._performUpdate();
		return this;
	}

	// ──────────────────────────────────────────────────────────
	// COORDINATE CONVERSION
	// ──────────────────────────────────────────────────────────

	/**
	 * Converts data coordinates to SVG user-space coordinates.
	 *
	 * @param {number} dataX
	 * @param {number} dataY
	 * @param {object} [chart]
	 * @returns {{ x: number, y: number }}
	 */
	toScreen(dataX, dataY, chart = null) {
		const yScale = chart ? this.getYScaleForChart(chart) : this.yScale;
		return {
			x: this.xScale.toScreen(dataX),
			y: yScale ? yScale.toScreen(dataY) : dataY
		};
	}

	/**
	 * Converts SVG user-space coordinates to data coordinates.
	 *
	 * @param {number} screenX
	 * @param {number} screenY
	 * @param {object} [chart]
	 * @returns {{ x: number, y: number }}
	 */
	toData(screenX, screenY, chart = null) {
		const yScale = chart ? this.getYScaleForChart(chart) : this.yScale;
		return {
			x: this.xScale.toData(screenX),
			y: yScale ? yScale.toData(screenY) : screenY
		};
	}

	// ──────────────────────────────────────────────────────────
	// INTERACTION MODE
	// ──────────────────────────────────────────────────────────

	/**
	 * Sets the interaction mode ('pan' or 'zoom').
	 *
	 * @param {'pan'|'zoom'} mode
	 * @returns {CartesianPlane} this
	 */
	setInteractionMode(mode) {
		if (mode !== 'pan' && mode !== 'zoom') return this;
		if (this.interactionMode === mode) return this;
		this.interactionMode = mode;
		this.events.emit(Events.INTERACTION_MODE_CHANGED, { plane: this, mode });
		return this;
	}

	/** @returns {boolean} */
	isXDomainLocked() { return this._xDomainLocked; }

	/** @returns {boolean} */
	isYDomainLocked(groupId) { return !!this._yDomainLocked[groupId]; }

	/**
	 * Zooms one or both axes by the given factor around an anchor value.
	 *
	 * @param {number} factor
	 * @param {number} [anchor]
	 * @param {'x'|'y'|'both'} [axis='x']
	 * @param {string} [groupId]
	 * @returns {CartesianPlane} this
	 */
	zoom(factor, anchor, axis = 'x', groupId = null) {
		if (!isFinite(factor) || factor <= 0) return this;

		if (axis === 'x' || axis === 'both') {
			const [xMin, xMax] = this.xScale.domain;
			const center = (anchor !== undefined && anchor !== null && isFinite(anchor))
				? anchor
				: (xMin + xMax) / 2;
			const newMin = center - (center - xMin) / factor;
			const newMax = center + (xMax - center) / factor;
			this.xScale.domain = [newMin, newMax];
			this._xDomainLocked = true;
			this.events.emit(Events.SCALE_DOMAIN_CHANGED, {
				plane: this, axis: 'x', domain: this.xScale.domain
			});
		}

		if (axis === 'y' || axis === 'both') {
			const groupIds = groupId ? [groupId] : Object.keys(this._yGroups);
			const yGroups = this._yGroups;
			for (let i = 0, len = groupIds.length; i < len; i++) {
				const gid = groupIds[i];
				const group = yGroups[gid];
				if (!group || !group.yScale) continue;

				const [yMin, yMax] = group.yScale.domain;
				const center = (anchor !== undefined && anchor !== null && isFinite(anchor))
					? anchor
					: (yMin + yMax) / 2;
				const newMin = center - (center - yMin) / factor;
				const newMax = center + (yMax - center) / factor;
				group.yScale.domain = [newMin, newMax];
				this._yDomainLocked[gid] = true;
				this.events.emit(Events.SCALE_DOMAIN_CHANGED, {
					plane: this, axis: 'y', groupId: gid, domain: group.yScale.domain
				});
			}
		}

		this._requestUpdate();
		return this;
	}

	/**
	 * Pans one or both axes by a pixel delta.
	 *
	 * @param {number} dx
	 * @param {number} dy
	 * @param {'x'|'y'|'both'} [axis='x']
	 * @param {string} [groupId]
	 * @returns {CartesianPlane} this
	 */
	pan(dx, dy, axis = 'x', groupId = null) {
		if (axis === 'x' || axis === 'both') {
			const xScale = this.xScale;
			const [xMin, xMax] = xScale.domain;
			const [rMin, rMax] = xScale.range;
			const pxRange = rMax - rMin || 1;
			const dataDelta = -(dx / pxRange) * (xMax - xMin);
			xScale.domain = [xMin + dataDelta, xMax + dataDelta];
			this._xDomainLocked = true;
			this.events.emit(Events.SCALE_DOMAIN_CHANGED, {
				plane: this, axis: 'x', domain: xScale.domain
			});
		}

		if (axis === 'y' || axis === 'both') {
			const groupIds = groupId ? [groupId] : Object.keys(this._yGroups);
			const yGroups = this._yGroups;
			const locked = this._yDomainLocked;
			for (let i = 0, len = groupIds.length; i < len; i++) {
				const gid = groupIds[i];
				if (!locked[gid]) continue;
				const group = yGroups[gid];
				if (!group || !group.yScale) continue;

				const [yMin, yMax] = group.yScale.domain;
				const [rMin, rMax] = group.yScale.range;
				const pxRange = rMax - rMin || 1;
				const dataDelta = -(dy / pxRange) * (yMax - yMin);
				group.yScale.domain = [yMin + dataDelta, yMax + dataDelta];
				this.events.emit(Events.SCALE_DOMAIN_CHANGED, {
					plane: this, axis: 'y', groupId: gid, domain: group.yScale.domain
				});
			}
		}

		this._requestUpdate();
		return this;
	}

	/**
	 * Clears all user-set domain locks.
	 *
	 * @param {'x'|'y'|'both'} [axis='both']
	 * @returns {CartesianPlane} this
	 */
	resetZoom(axis = 'both', groupId = null) {
		if (axis === 'x' || axis === 'both') this._xDomainLocked = false;
		if (axis === 'y' || axis === 'both') {
			if (groupId) {
				delete this._yDomainLocked[groupId];
			} else {
				this._yDomainLocked = Object.create(null);
			}
		}
		this._domainDirty = true;
		this._requestUpdate();
		return this;
	}
}

export default CartesianPlane;