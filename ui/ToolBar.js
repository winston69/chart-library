// ──────────────────────────────────────────────────────────────
// ToolBar.js
//
// A toolbar rendered into the plane's HTML overlay. Items are
// organized into groups. Each group has an id and a label. The
// first group, `tool`, is created automatically and is where
// ungrouped `addItem` calls land.
//
// Groups render in creation order. Each group's cluster shows
// its label (when showGroupLabels is true and the group's own
// showLabel flag allows) followed by its items. Groups with no
// items still render — an empty labeled group communicates
// "this category exists but has no entries" and can be used as
// a status readout.
//
// Public API:
//   addItem(item, { group })      → routes to a group
//   addGroup({ id, label, showLabel }) → returns a group handle
//   removeItem(itemOrId)
//   clearItems()                  — empties groups, keeps their descriptors
//   getItems()
//   getGroup(id)
//   getGroups()
//
// Group handle:
//   { id, label, showLabel, addItem, addItems, removeItem,
//     setLabel, setShowLabel, getItems }
//
// The `label` is a property of the group and is always available
// (for settings UI, renaming, status text). Whether it renders
// is governed by the toolbar's `showGroupLabels` and the group's
// own `showLabel` override.
// ──────────────────────────────────────────────────────────────

import { CSS } from '../core/CSS.js';
import { Layer } from '../core/Layer.js';
import { Events } from '../core/Events.js';

const css = CSS.toolbar;

const DEFAULT_PADDING = 4;
const DEFAULT_ITEM_SPACING = 4;
const DEFAULT_BUTTON_HEIGHT = 22;

const DEFAULT_GROUP_ID = 'tool';
const DEFAULT_GROUP_LABEL = 'Tools';

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

		// ─── CONFIGURATION ───
		this.position = options.position || 'top';
		this.orientation = (this.position === 'top' || this.position === 'bottom')
			? 'horizontal'
			: 'vertical';

		this.padding = options.padding !== undefined ? options.padding : DEFAULT_PADDING;
		this.itemSpacing = options.itemSpacing !== undefined ? options.itemSpacing : DEFAULT_ITEM_SPACING;

		// Toolbar-level display toggle for group labels. Individual
		// groups can override via their own `showLabel` flag.
		this.showGroupLabels = options.showGroupLabels !== undefined
			? options.showGroupLabels
			: true;

		// ─── GROUPS ───
		// Ordered list of group descriptors. The `tool` group is
		// always present and always first.
		this._groups = [];
		this._groupsById = Object.create(null);

		// ─── ITEM ELEMENT CACHE ───
		// Flat list of DOM elements rendered this pass, in order.
		this._itemEls = [];

		this._itemsDirty = true;

		// ─── DOM ───
		this._elements = {
			root: null,
			itemsEl: null
		};

		this._contentCreated = false;
		this._layoutDirty = true;
		this._cachedSize = null;

		this._unsubscribeEvents = [];

		// Create the implicit default group.
		this._createGroup({
			id: DEFAULT_GROUP_ID,
			label: DEFAULT_GROUP_LABEL
		});
	}

	// ──────────────────────────────────────────────────────────
	// EVENT SUBSCRIPTIONS
	// ──────────────────────────────────────────────────────────

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

	// ──────────────────────────────────────────────────────────
	// GROUP MANAGEMENT
	// ──────────────────────────────────────────────────────────

	_createGroup(opts) {
		const id = opts.id;
		if (!id) throw new Error('ToolBar group: id is required.');
		if (this._groupsById[id]) {
			throw new Error(`ToolBar group: "${id}" already exists.`);
		}

		const group = {
			id,
			label: opts.label || id,
			showLabel: opts.showLabel,     // undefined → inherit toolbar setting
			items: []
		};

		this._groups.push(group);
		this._groupsById[id] = group;
		return group;
	}

	/**
	 * Creates a new group and returns a handle for adding items to
	 * it. The group renders in creation order.
	 *
	 *   const dataGroup = toolbar.addGroup({ id: 'data', label: 'Data' });
	 *   dataGroup.addItem(timeframeDropdown);
	 */
	addGroup(opts = {}) {
		const group = this._createGroup({
			id: opts.id,
			label: opts.label,
			showLabel: opts.showLabel
		});

		this._itemsDirty = true;
		this._layoutDirty = true;
		this._cachedSize = null;
		this._requestUpdate();

		return this._makeGroupHandle(group);
	}

	getGroup(id) {
		const group = this._groupsById[id];
		return group ? this._makeGroupHandle(group) : null;
	}

	getGroups() {
		return this._groups.map(g => this._makeGroupHandle(g));
	}

	_makeGroupHandle(group) {
		const self = this;
		return {
			get id() { return group.id; },
			get label() { return group.label; },
			get showLabel() { return group.showLabel; },
			get items() { return group.items.slice(); },

			addItem(item) {
				if (!item || typeof item.render !== 'function') {
					throw new Error('ToolBar: item must implement render(container)');
				}
				if (group.items.indexOf(item) !== -1) return item;
				group.items.push(item);
				self._itemsDirty = true;
				self._layoutDirty = true;
				self._cachedSize = null;
				self._requestUpdate();
				return item;
			},

			addItems(items) {
				for (let i = 0; i < items.length; i++) this.addItem(items[i]);
				return items;
			},

			removeItem(itemOrId) {
				const idx = typeof itemOrId === 'string'
					? group.items.findIndex(c => c.id === itemOrId)
					: group.items.indexOf(itemOrId);
				if (idx === -1) return self;

				const item = group.items[idx];
				group.items.splice(idx, 1);

				if (typeof item.destroy === 'function') {
					try { item.destroy(); } catch (e) { /* ignore */ }
				}

				self._itemsDirty = true;
				self._layoutDirty = true;
				self._cachedSize = null;
				self._requestUpdate();
				return self;
			},

			setLabel(text) {
				group.label = text;
				self._itemsDirty = true;
				self._requestUpdate();
				return self;
			},

			setShowLabel(flag) {
				group.showLabel = flag;
				self._itemsDirty = true;
				self._requestUpdate();
				return self;
			}
		};
	}

	/**
	 * Returns the group a new item should be added to.
	 * Auto-creates a group if the id is unknown (created without a
	 * label; the caller can set one later via getGroup(id).setLabel).
	 */
	_resolveTargetGroup(groupId) {
		const id = groupId || DEFAULT_GROUP_ID;
		let group = this._groupsById[id];
		if (!group) {
			group = this._createGroup({ id, label: id });
		}
		return group;
	}

	// ──────────────────────────────────────────────────────────
	// ITEM MANAGEMENT
	// ──────────────────────────────────────────────────────────

	/**
	 * Adds an item to a group. Without `options.group`, the item
	 * lands in the default `tool` group.
	 */
	addItem(item, options = {}) {
		if (!item || typeof item.render !== 'function') {
			throw new Error('ToolBar.addItem: item must implement render(container)');
		}

		const group = this._resolveTargetGroup(options.group);
		if (group.items.indexOf(item) !== -1) return item;

		group.items.push(item);
		this._itemsDirty = true;
		this._layoutDirty = true;
		this._cachedSize = null;
		this._requestUpdate();
		return item;
	}

	removeItem(itemOrId) {
		for (let gi = 0; gi < this._groups.length; gi++) {
			const group = this._groups[gi];
			const idx = typeof itemOrId === 'string'
				? group.items.findIndex(c => c.id === itemOrId)
				: group.items.indexOf(itemOrId);
			if (idx === -1) continue;

			const item = group.items[idx];
			group.items.splice(idx, 1);

			if (typeof item.destroy === 'function') {
				try { item.destroy(); } catch (e) { /* ignore */ }
			}

			this._itemsDirty = true;
			this._layoutDirty = true;
			this._cachedSize = null;
			this._requestUpdate();
			return this;
		}
		return this;
	}

	/**
	 * Empties every group but keeps the group descriptors. The
	 * toolbar structure (labels, dividers) remains.
	 */
	clearItems() {
		for (let gi = 0; gi < this._groups.length; gi++) {
			const group = this._groups[gi];
			for (let ii = 0; ii < group.items.length; ii++) {
				const item = group.items[ii];
				if (typeof item.destroy === 'function') {
					try { item.destroy(); } catch (e) { /* ignore */ }
				}
			}
			group.items = [];
		}

		this._itemsDirty = true;
		this._layoutDirty = true;
		this._cachedSize = null;
		this._requestUpdate();
		return this;
	}

	getItems() {
		const all = [];
		for (let gi = 0; gi < this._groups.length; gi++) {
			const items = this._groups[gi].items;
			for (let ii = 0; ii < items.length; ii++) all.push(items[ii]);
		}
		return all;
	}

	// ──────────────────────────────────────────────────────────
	// MARGIN REQUEST
	// ──────────────────────────────────────────────────────────

	getMarginRequest() {
		if (this.getItems().length === 0 && this._groups.length === 0) return null;

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

	// ──────────────────────────────────────────────────────────
	// RENDER
	// ──────────────────────────────────────────────────────────

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
		// Their Button instances still own their root elements; we
		// just take them out of the tree so we can re-append in order.
		while (itemsEl.firstChild) {
			itemsEl.removeChild(itemsEl.firstChild);
		}
		this._itemEls = [];

		for (let gi = 0; gi < this._groups.length; gi++) {
			const group = this._groups[gi];

			const clusterEl = document.createElement('div');
			clusterEl.className = css.groupCluster;
			clusterEl.dataset.group = group.id;

			// Resolve whether this group's label renders.
			// Undefined → inherit the toolbar-level toggle.
			const showLabel = group.showLabel !== undefined
				? group.showLabel
				: this.showGroupLabels;

			if (showLabel && group.label) {
				const labelEl = document.createElement('span');
				labelEl.className = css.groupLabel;
				labelEl.textContent = group.label;
				clusterEl.appendChild(labelEl);
			}

			const itemsContainer = document.createElement('div');
			itemsContainer.className = css.groupItems;
			clusterEl.appendChild(itemsContainer);

			for (let ii = 0; ii < group.items.length; ii++) {
				const item = group.items[ii];
				const el = item.render(itemsContainer);
				if (el) this._itemEls.push(el);
			}

			itemsEl.appendChild(clusterEl);
		}
	}

	// ──────────────────────────────────────────────────────────
	// LAYOUT
	// ──────────────────────────────────────────────────────────

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

	// ──────────────────────────────────────────────────────────
	// UPDATE
	// ──────────────────────────────────────────────────────────

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

	// ──────────────────────────────────────────────────────────
	// DESTROY
	// ──────────────────────────────────────────────────────────

	destroy() {
		this._unsubscribeFromPlaneEvents();

		for (let gi = 0; gi < this._groups.length; gi++) {
			const group = this._groups[gi];
			for (let ii = 0; ii < group.items.length; ii++) {
				const item = group.items[ii];
				if (typeof item.destroy === 'function') {
					try { item.destroy(); } catch (e) { /* ignore */ }
				}
			}
			group.items = [];
		}
		this._groups = [];
		this._groupsById = Object.create(null);
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