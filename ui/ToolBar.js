// ──────────────────────────────────────────────────────────────
// ToolBar.js
// ──────────────────────────────────────────────────────────────

import { CSS } from '../core/CSS.js';
import { Layer } from '../core/Layer.js';
import { Events } from '../core/Events.js';

const css = CSS.toolbar;

const DEFAULT_PADDING = 4;
const DEFAULT_ITEM_SPACING = 4;
const DEFAULT_BUTTON_HEIGHT = 22;

export class ToolBar extends Layer {
	constructor(options = {}) {
		super({
			id: options.id,
			type: 'toolbar',
			name: options.name || 'ToolBar',
			label: options.label || 'ToolBar',
			plane: options.plane,
			onUpdate: options.onUpdate,
			onDestroy: options.onDestroy
		});

		this.slot = 'html-overlay';
		this.z = 5;

		this.isDataLayer = false;
		this.needsMargin = true;

		// Configuration
		this.position = options.position || 'top';
		this.orientation = (this.position === 'top' || this.position === 'bottom')
			? 'horizontal'
			: 'vertical';

		this.padding = options.padding !== undefined ? options.padding : DEFAULT_PADDING;
		this.itemSpacing = options.itemSpacing !== undefined ? options.itemSpacing : DEFAULT_ITEM_SPACING;

		// Items
		this._items = [];
		this._itemEls = [];
		this._itemsDirty = true;

		// DOM
		this._elements = {
			root: null,
			itemsEl: null
		};

		this._contentCreated = false;
		this._layoutDirty = true;
		this._cachedSize = null;

		this._unsubscribeEvents = [];
	}

	// ─── Event subscriptions ───
	_setupEventListeners() {
		if (!this.plane || !this.plane.events) return;
		const events = this.plane.events;

		const onLayout = () => {
			this._layoutDirty = true;
			this._cachedSize = null;
		};

		this._unsubscribeEvents = [
			events.on(Events.MARGINS_CHANGED, onLayout),
			events.on(Events.PLANE_RESIZED, onLayout),
			events.on(Events.FULLSCREEN_CHANGED, onLayout)
		];
	}

	_unsubscribeFromPlaneEvents() {
		for (let i = 0, len = this._unsubscribeEvents.length; i < len; i++) {
			try { this._unsubscribeEvents[i](); } catch (e) { /* ignore */ }
		}
		this._unsubscribeEvents = [];
	}

	// ─── Item management ───
	addItem(item) {
		if (!item || typeof item.render !== 'function') {
			throw new Error('ToolBar.addItem: item must implement render(container)');
		}
		if (this._items.indexOf(item) !== -1) return item;

		this._items.push(item);
		this._itemsDirty = true;
		this._layoutDirty = true;
		this._cachedSize = null;
		this._requestUpdate();
		return item;
	}

	removeItem(itemOrId) {
		const idx = typeof itemOrId === 'string'
			? this._items.findIndex(c => c.id === itemOrId)
			: this._items.indexOf(itemOrId);
		if (idx === -1) return this;

		const item = this._items[idx];
		this._items.splice(idx, 1);

		if (typeof item.destroy === 'function') {
			try { item.destroy(); } catch (e) { /* ignore */ }
		}

		this._itemsDirty = true;
		this._layoutDirty = true;
		this._cachedSize = null;
		this._requestUpdate();
		return this;
	}

	clearItems() {
		for (let i = 0, len = this._items.length; i < len; i++) {
			const item = this._items[i];
			if (typeof item.destroy === 'function') {
				try { item.destroy(); } catch (e) { /* ignore */ }
			}
		}
		this._items = [];
		this._itemsDirty = true;
		this._layoutDirty = true;
		this._cachedSize = null;
		this._requestUpdate();
		return this;
	}

	getItems() {
		return this._items.slice();
	}

	// ─── Margin request ───
	getMarginRequest() {
		if (this._items.length === 0) return null;

		const size = this._measure();
		if (!size) return null;

		const total = size.thickness + this.padding * 2 + 2;

		switch (this.position) {
			case 'top': return { top: total };
			case 'bottom': return { bottom: total };
			case 'left': return { left: total };
			case 'right': return { right: total };
			default: return { top: total };
		}
	}

	_measure() {
		if (this._cachedSize) return this._cachedSize;

		const itemsEl = this._elements.itemsEl;
		if (!itemsEl) {
			const thickness = DEFAULT_BUTTON_HEIGHT;
			this._cachedSize = { thickness, length: 0 };
			return this._cachedSize;
		}

		const rect = itemsEl.getBoundingClientRect();
		if (rect.width === 0 && rect.height === 0) {
			this._cachedSize = { thickness: DEFAULT_BUTTON_HEIGHT, length: 0 };
			return this._cachedSize;
		}

		const isHorizontal = this.orientation === 'horizontal';
		this._cachedSize = {
			thickness: isHorizontal ? rect.height : rect.width,
			length: isHorizontal ? rect.width : rect.height
		};
		return this._cachedSize;
	}

	// ─── Render ───
	render(container) {
		if (!this._contentCreated) {
			this._createContent(container);
			this._contentCreated = true;
		} else if (this._elements.root && !this._elements.root.parentNode) {
			container.appendChild(this._elements.root);
		}

		if (this._unsubscribeEvents.length === 0) {
			this._setupEventListeners();
		}

		if (this._itemsDirty) {
			this._rebuildItems();
			this._itemsDirty = false;
		}
		this._updateLayout();
		return this._elements.root;
	}

	_createContent(container) {
		const el = this._elements;

		const root = document.createElement('div');
		root.id = `${this.id}-root`;
		root.className = `${css.container} tb-${this.position} tb-${this.orientation}`;
		el.root = root;

		const itemsEl = document.createElement('div');
		itemsEl.id = `${this.id}-items`;
		itemsEl.className = css.group;
		root.appendChild(itemsEl);
		el.itemsEl = itemsEl;

		container.appendChild(root);
	}

	_rebuildItems() {
		const itemsEl = this._elements.itemsEl;
		if (!itemsEl) return;

		// Detach existing items from the DOM without destroying them.
		// Their Button instances still own their root elements; we just
		// take them out of the tree so we can re-append in order.
		while (itemsEl.firstChild) {
			itemsEl.removeChild(itemsEl.firstChild);
		}
		this._itemEls = [];

		for (let i = 0, len = this._items.length; i < len; i++) {
			const item = this._items[i];
			const el = item.render(itemsEl);
			if (el) this._itemEls.push(el);
		}
	}

	// ─── Layout ───
	_updateLayout() {
		const root = this._elements.root;
		const plane = this.plane;
		if (!root || !plane) return;

		const plot = plane.getPlotArea();

		switch (this.position) {
			case 'top':
				root.style.left = `${plot.left}px`;
				root.style.right = `${plane.width - plot.right}px`;
				root.style.top = `${Math.max(0, plot.top - this._measure().thickness - this.padding * 2 - 2)}px`;
				root.style.bottom = 'auto';
				break;
			case 'bottom':
				root.style.left = `${plot.left}px`;
				root.style.right = `${plane.width - plot.right}px`;
				root.style.top = `${plot.bottom + this.padding + 2}px`;
				root.style.bottom = 'auto';
				break;
			case 'left':
				root.style.top = `${plot.top}px`;
				root.style.bottom = `${plane.height - plot.bottom}px`;
				root.style.left = `${Math.max(0, plot.left - this._measure().thickness - this.padding * 2 - 2)}px`;
				root.style.right = 'auto';
				break;
			case 'right':
				root.style.top = `${plot.top}px`;
				root.style.bottom = `${plane.height - plot.bottom}px`;
				root.style.left = `${plot.right + this.padding + 2}px`;
				root.style.right = 'auto';
				break;
		}

		this._layoutDirty = false;
	}

	// ─── Update ───
	update() {
		if (!this._contentCreated) {
			if (this.plane && this.plane._elements.htmlOverlay) {
				this.render(this.plane._elements.htmlOverlay);
			}
			return this;
		}

		if (this._itemsDirty) {
			this._rebuildItems();
			this._itemsDirty = false;
		}

		if (this._layoutDirty) this._updateLayout();

		this._updateCount++;
		if (this.onUpdate) this.onUpdate(this);
		return this;
	}

	forceUpdate() {
		this._layoutDirty = true;
		this._cachedSize = null;
		this._itemsDirty = true;
		this._rebuildItems();
		this._updateLayout();
		this.update();
		return this;
	}

	_requestUpdate() {
		if (this.plane && typeof this.plane._requestUpdate === 'function') {
			this.plane._requestUpdate();
		}
	}

	// ─── Destroy ───
	destroy() {
		this._unsubscribeFromPlaneEvents();

		for (let i = 0, len = this._items.length; i < len; i++) {
			const item = this._items[i];
			if (typeof item.destroy === 'function') {
				try { item.destroy(); } catch (e) { /* ignore */ }
			}
		}
		this._items = [];
		this._itemEls = [];

		super.destroy();

		const root = this._elements.root;
		if (root && root.parentNode) root.parentNode.removeChild(root);

		this._elements = { root: null, itemsEl: null };
		this._contentCreated = false;
		this._cachedSize = null;
		this._itemsDirty = true;
	}
}

export default ToolBar;