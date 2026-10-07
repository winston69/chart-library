// ──────────────────────────────────────────────────────────────
// Legend.js
//
// A legend rendered as a CardStrip card. Shows one row per data layer
// on the plane. Reads and writes the plane's shared selection:
//
//   - Click       → selection.select(layer)
//   - Ctrl+click  → selection.toggle(layer)
//
// Rendering states are derived from selection:
//   - Selection empty        → all items normal
//   - Item in selection      → selected (highlighted)
//   - Item not in selection  → unselected (dimmed)
//
// Subscribes to plane events that affect its content:
//   - LAYER_ADDED / LAYER_REMOVED  → rebuild the item list
//   - SELECTION_CHANGED            → update item states
//   - LAYER_UPDATED                → update the values shown per item
//
// Implements the CardStrip card interface:
//   id, width, render(container), update(), destroy()
//
// Optimizations:
//   - Item lookup uses Object.create(null) keyed by layer id, no Map.
//   - Each item holds its own DOM references (root, value) directly —
//     no intermediate _dom object, no querySelector.
//   - Value text diffed before writing.
//   - State class diffed before writing.
// ──────────────────────────────────────────────────────────────

import { Events } from '../core/Events.js';
import { CSS } from '../core/CSS.js';

const css = CSS.legend;

const DEFAULT_WIDTH = 120;

export class Legend {
	constructor(options = {}) {
		this.id = options.id || `legend-${Math.random().toString(36).slice(2, 8)}`;
		this.plane = options.plane || null;

		// ─── CONTENT ───
		this.items = options.items || [];
		this.title = options.title || null;
		this.autoDetect = options.autoDetect !== undefined ? options.autoDetect : true;

		// ─── CARD GEOMETRY ───
		this.width = options.width || DEFAULT_WIDTH;

		// ─── ACCESSORS ───
		this.colorAccessor = options.colorAccessor || ((layer) => {
			if (typeof layer.getColor === 'function') {
				const c = layer.getColor();
				if (c) return c;
			}
			if (layer.color) return layer.color;
			const fallbacks = ['#4ade80', '#ffd43b', '#845ef7', '#ff6b6b', '#4dabf7', '#20c997'];
			return fallbacks[Math.abs(layer.id?.length || 0) % fallbacks.length] || '#4ade80';
		});

		this.labelAccessor = options.labelAccessor || ((layer) => {
			if (layer.label) return layer.label;
			if (layer.name) return layer.name;
			if (layer.type) return layer.type.charAt(0).toUpperCase() + layer.type.slice(1);
			if (layer.id) {
				return layer.id.replace(/-chart$/, '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
			}
			return 'Series';
		});

		this.valueFormat = options.valueFormat || ((v) => v.toFixed(2));

		// ─── CALLBACKS ───
		this.onItemClick = options.onItemClick || null;

		// ─── SELECTION ───
		this.selection = options.selection || null;

		// ─── DOM ───
		this._elements = {
			root: null,
			titleEl: null,
			itemsEl: null
		};

		// ─── ITEM REGISTRY ───
		// Keyed by layer id → item object. Each item holds:
		//   label, color, layer, value,
		//   rowEl, markerEl, labelEl, valueEl,
		//   _state, _lastValue
		this._itemsById = Object.create(null);
		this._itemList = [];

		this._fingerprint = '';
		this._itemsDirty = true;

		this._unsubscribeEvents = [];
	}

	// ──────────────────────────────────────────────────────────
	// EVENT SUBSCRIPTIONS
	// ──────────────────────────────────────────────────────────

	_setupEventListeners() {
		if (!this.plane || !this.plane.events) return;
		const events = this.plane.events;

		const onLayersChanged = () => { this._itemsDirty = true; };
		const onLayerUpdated = () => { this._updateValues(); };

		this._unsubscribeEvents = [
			events.on(Events.LAYER_ADDED, onLayersChanged),
			events.on(Events.LAYER_REMOVED, onLayersChanged),
			events.on(Events.LAYER_UPDATED, onLayerUpdated)
		];

		// Selection is optional. Subscribe to its own emitter.
		if (this.selection && this.selection.events) {
			this._unsubscribeEvents.push(
				this.selection.events.on(Events.SELECTION_CHANGED, () => {
					this._applyStates();
				})
			);
		}
	}

	_unsubscribeFromPlaneEvents() {
		for (let i = 0, len = this._unsubscribeEvents.length; i < len; i++) {
			try { this._unsubscribeEvents[i](); } catch (e) { /* ignore */ }
		}
		this._unsubscribeEvents = [];
	}

	_countDataLayers() {
		const plane = this.plane;
		if (!plane) return 0;
		const layers = plane.getLayers();
		let count = 0;
		for (let i = 0, len = layers.length; i < len; i++) {
			const layer = layers[i];
			if (typeof layer.getDomain !== 'function') continue;
			const domain = layer.getDomain();
			if (domain && domain.hasData) count++;
		}
		return count;
	}

	// ──────────────────────────────────────────────────────────
	// CARD INTERFACE
	// ──────────────────────────────────────────────────────────

	render(container) {
		if (!this._elements.root) this._createContent();
		if (this._unsubscribeEvents.length === 0) this._setupEventListeners();
		container.appendChild(this._elements.root);
		this._fingerprint = '';
		this._rebuildItems();
		this._applyStates();
		return this._elements.root;
	}

	update() {
		// Cheap resync against the live layer set. Catches the case
		// where a data layer transitions from empty to has-data
		// without firing LAYER_ADDED (e.g. setData after construction).
		if (this.autoDetect && this._itemList.length !== this._countDataLayers()) {
			this._itemsDirty = true;
		}

		if (this._itemsDirty) {
			this._rebuildItems();
			this._itemsDirty = false;
		}

		this._updateValues();
		this._applyStates();
	}

	destroy() {
		this._unsubscribeFromPlaneEvents();

		if (this._elements.root && this._elements.root.parentNode) {
			this._elements.root.parentNode.removeChild(this._elements.root);
		}

		this._elements = {
			root: null,
			titleEl: null,
			itemsEl: null
		};
		this._itemsById = Object.create(null);
		this._itemList = [];
		this._fingerprint = '';
		this._itemsDirty = true;
	}

	// ──────────────────────────────────────────────────────────
	// DOM
	// ──────────────────────────────────────────────────────────

	_createContent() {
		const root = document.createElement('div');
		root.className = css.card;

		if (this.title) {
			const titleEl = document.createElement('div');
			titleEl.className = css.title;
			titleEl.textContent = this.title;
			root.appendChild(titleEl);
			this._elements.titleEl = titleEl;
		}

		const itemsEl = document.createElement('div');
		itemsEl.className = css.items;
		root.appendChild(itemsEl);
		this._elements.itemsEl = itemsEl;

		this._elements.root = root;
	}

	// ──────────────────────────────────────────────────────────
	// ITEMS
	// ──────────────────────────────────────────────────────────

	_collectItems() {
		const plane = this.plane;
		if (!plane) return [];

		if (this.items && this.items.length > 0) {
			return this.items.map(i => ({
				label: i.label,
				color: i.color,
				layer: i.layer || null,
				format: i.format || null
			}));
		}
		if (!this.autoDetect) return [];

		const layers = plane.getLayers();
		const result = [];

		for (let i = 0, len = layers.length; i < len; i++) {
			const layer = layers[i];
			if (typeof layer.getDomain !== 'function') continue;
			const domain = layer.getDomain();
			if (!domain || !domain.hasData) continue;

			result.push({
				label: this.labelAccessor(layer),
				color: this.colorAccessor(layer),
				layer,
				value: null
			});
		}
		return result;
	}

	_getFingerprint(items) {
		let fp = '';
		for (let i = 0, len = items.length; i < len; i++) {
			const it = items[i];
			fp += (it.layer ? it.layer.id : '') + '|' + (it.label || '') + '|' + (it.color || '') + ';';
		}
		return fp;
	}

	_rebuildItems() {
		const itemsEl = this._elements.itemsEl;
		if (!itemsEl) return;

		const source = this._collectItems();
		const fp = this._getFingerprint(source);

		if (fp === this._fingerprint) {
			// Fingerprint unchanged. Keep existing item objects and their
			// cached DOM; only refresh the label/color fields in case the
			// underlying layer changed them.
			for (let i = 0, len = source.length; i < len; i++) {
				const fresh = source[i];
				const existing = fresh.layer ? this._itemsById[fresh.layer.id] : null;
				if (existing) {
					existing.label = fresh.label;
					existing.color = fresh.color;
					existing.layer = fresh.layer;
				}
			}
			return;
		}
		this._fingerprint = fp;

		// Clear existing DOM.
		while (itemsEl.firstChild) itemsEl.removeChild(itemsEl.firstChild);

		// Reset the registry and list.
		this._itemsById = Object.create(null);
		this._itemList = [];

		for (let i = 0, len = source.length; i < len; i++) {
			const fresh = source[i];
			const item = {
				label: fresh.label,
				color: fresh.color,
				layer: fresh.layer,
				value: fresh.value,
				rowEl: null,
				markerEl: null,
				labelEl: null,
				valueEl: null,
				_state: null,
				_lastValue: null
			};

			const el = this._createItemElement(item, i);
			itemsEl.appendChild(el);

			if (item.layer) this._itemsById[item.layer.id] = item;
			this._itemList.push(item);
		}
	}

	_createItemElement(item, index) {
		const el = document.createElement('div');
		el.className = css.item;

		const marker = document.createElement('span');
		marker.className = css.marker;
		marker.style.background = item.color;
		el.appendChild(marker);

		const label = document.createElement('span');
		label.className = css.label;
		label.textContent = item.label;
		el.appendChild(label);

		const value = document.createElement('span');
		value.className = css.value;
		el.appendChild(value);

		// Attach DOM references directly on the item object.
		item.rowEl = el;
		item.markerEl = marker;
		item.labelEl = label;
		item.valueEl = value;

		el.addEventListener('click', (evt) => {
			const selection = this.selection;
			if (!item.layer || !selection) return;
			if (evt.ctrlKey || evt.metaKey) selection.toggle(item.layer);
			else selection.select(item.layer);
			if (this.onItemClick) this.onItemClick(index, item.layer, evt);
		});

		return el;
	}

	/**
	 * Updates the numeric value shown next to each legend item.
	 * Reads item.valueEl directly. Diff-checks against item._lastValue.
	 */
	_updateValues() {
		const items = this._itemList;
		const defaultFmt = this.valueFormat;

		for (let i = 0, len = items.length; i < len; i++) {
			const item = items[i];
			if (!item.layer || !item.valueEl) continue;

			const stats = item.layer.getStats ? item.layer.getStats() : null;
			const v = stats && stats.hasData ? stats.lastY : null;
			const fmt = item.format || defaultFmt;
			const display = (v !== null && isFinite(v)) ? fmt(v) : '';

			if (item._lastValue === display) continue;
			item._lastValue = display;
			item.valueEl.textContent = display;
		}
	}

	/**
	 * Applies selection-derived state classes to each legend item.
	 * Diff-checks against item._state.
	 */
	_applyStates() {
		const selection = this.selection;
		if (!selection) return;

		const empty = selection.isEmpty();
		const items = this._itemList;

		for (let i = 0, len = items.length; i < len; i++) {
			const item = items[i];
			if (!item.layer || !item.rowEl) continue;

			let next;
			if (empty) next = 'normal';
			else if (selection.has(item.layer)) next = 'selected';
			else next = 'unselected';

			if (item._state === next) continue;
			item._state = next;

			const classes = item.rowEl.classList;
			classes.remove('normal', 'selected', 'unselected');
			classes.add(next);
		}
	}
}

export default Legend;