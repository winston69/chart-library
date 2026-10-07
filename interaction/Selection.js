// ──────────────────────────────────────────────────────────────
// Selection.js
//
// Base class for selection domains. Holds a set of selected ids
// in a plain object created via Object.create(null) — faster
// has/add/delete than Set, no iterator allocations on iteration.
//
// Subclasses provide the domain specifics (see ABSTRACT section).
// The base class provides all mutation/query methods, the click
// handler, the class-application loop, and change events.
//
// No reference to a plane, layer registry, or any specific domain.
// ──────────────────────────────────────────────────────────────

import { EventEmitter, Events } from '../core/Events.js';

export class Selection {
	/**
	 * @param {object} options
	 * @param {Element} options.element - The DOM element to attach click listeners to
	 */
	constructor(options = {}) {
		this._element = options.element || null;
		this._ids = Object.create(null);
		this._count = 0;
		this.events = new EventEmitter();
		this._onClick = this._onClick.bind(this);

		if (this._element) {
			this._element.addEventListener('click', this._onClick);
		}
	}

	// ──────────────────────────────────────────────────────────
	// ABSTRACT — subclasses override
	// ──────────────────────────────────────────────────────────

	/**
	 * Given a DOM element from a click event, return the selectable
	 * item it belongs to, or null.
	 *
	 * @param {Element} domElement
	 * @returns {object|null}
	 */
	resolve(domElement) { return null; }

	/**
	 * Returns every selectable item in the domain.
	 *
	 * @returns {object[]}
	 */
	getAll() { return []; }

	/**
	 * Returns the DOM element for a given item, where state classes
	 * are applied.
	 *
	 * @param {object} item
	 * @returns {Element|null}
	 */
	targetOf(item) { return null; }

	/**
	 * Extracts a stable id from an item.
	 *
	 * @param {object} item
	 * @returns {string}
	 */
	idOf(item) { return item && item.id; }

	/**
	 * Returns the CSS class names for the three visual states.
	 * Subclasses should build this once and return a cached object.
	 *
	 * @returns {{ normal: string, selected: string, unselected: string }}
	 */
	getClassNames() {
		return {
			normal: 'sel-normal',
			selected: 'sel-selected',
			unselected: 'sel-unselected'
		};
	}

	// ──────────────────────────────────────────────────────────
	// QUERY
	// ──────────────────────────────────────────────────────────

	/**
	 * @param {object|string} itemOrId
	 * @returns {boolean}
	 */
	has(itemOrId) {
		const id = this._idOfItem(itemOrId);
		return id != null && this._ids[id] === true;
	}

	/** @returns {boolean} */
	isEmpty() { return this._count === 0; }

	/** @returns {number} */
	count() { return this._count; }

	/** @returns {string[]} */
	getIds() { return Object.keys(this._ids); }

	/**
	 * Returns the selected items, resolved from the current getAll() set.
	 *
	 * @returns {object[]}
	 */
	get() {
		const all = this.getAll();
		const ids = this._ids;
		const idOf = this.idOf;
		const result = [];

		for (let i = 0, len = all.length; i < len; i++) {
			const item = all[i];
			if (ids[idOf(item)] === true) result.push(item);
		}
		return result;
	}

	// ──────────────────────────────────────────────────────────
	// MUTATION
	// ──────────────────────────────────────────────────────────

	/**
	 * Replaces the entire selection with the given item. Clicking the
	 * already-sole-selected item clears the selection.
	 *
	 * @param {object|string} itemOrId
	 */
	select(itemOrId) {
		const id = this._idOfItem(itemOrId);
		if (id == null) return;

		if (this._count === 1 && this._ids[id] === true) {
			this._ids = Object.create(null);
			this._count = 0;
			this._afterChange();
			return;
		}

		this._ids = Object.create(null);
		this._ids[id] = true;
		this._count = 1;
		this._afterChange();
	}

	/**
	 * Adds the item to the selection without clearing the rest.
	 * No-op if already present.
	 *
	 * @param {object|string} itemOrId
	 */
	add(itemOrId) {
		const id = this._idOfItem(itemOrId);
		if (id == null) return;
		if (this._ids[id] === true) return;
		this._ids[id] = true;
		this._count++;
		this._afterChange();
	}

	/**
	 * Removes the item. No-op if not present.
	 *
	 * @param {object|string} itemOrId
	 */
	remove(itemOrId) {
		const id = this._idOfItem(itemOrId);
		if (id == null) return;
		if (this._ids[id] !== true) return;
		delete this._ids[id];
		this._count--;
		this._afterChange();
	}

	/**
	 * Toggles the item in or out without clearing the rest.
	 *
	 * @param {object|string} itemOrId
	 */
	toggle(itemOrId) {
		const id = this._idOfItem(itemOrId);
		if (id == null) return;

		if (this._ids[id] === true) {
			delete this._ids[id];
			this._count--;
		} else {
			this._ids[id] = true;
			this._count++;
		}
		this._afterChange();
	}

	/** Empties the selection. */
	clear() {
		if (this._count === 0) return;
		this._ids = Object.create(null);
		this._count = 0;
		this._afterChange();
	}

	/**
	 * Drops an id if present. Used by wiring layers when an underlying
	 * item is removed from the domain.
	 *
	 * @param {object|string} itemOrId
	 */
	forget(itemOrId) {
		const id = this._idOfItem(itemOrId);
		if (id == null) return;
		if (this._ids[id] !== true) return;
		delete this._ids[id];
		this._count--;
		this._afterChange();
	}

	// ──────────────────────────────────────────────────────────
	// CLICK HANDLING
	// ──────────────────────────────────────────────────────────

	_onClick(evt) {
		const item = this.resolve(evt.target);
		if (!item) return;

		if (evt.ctrlKey || evt.metaKey) this.toggle(item);
		else this.select(item);
	}

	// ──────────────────────────────────────────────────────────
	// INTERNAL
	// ──────────────────────────────────────────────────────────

	_idOfItem(itemOrId) {
		if (itemOrId == null) return null;
		if (typeof itemOrId === 'string') return itemOrId;
		return this.idOf(itemOrId);
	}

	_afterChange() {
		this._applyClasses();
		this.events.emit(Events.SELECTION_CHANGED, {
			selection: this,
			ids: this.getIds(),
			items: this.get()
		});
	}

	_applyClasses() {
		const all = this.getAll();
		const ids = this._ids;
		const cls = this.getClassNames();
		const idOf = this.idOf;
		const targetOf = this.targetOf;
		const empty = this._count === 0;

		for (let i = 0, len = all.length; i < len; i++) {
			const item = all[i];
			const el = targetOf(item);
			if (!el || !el.classList) continue;

			const classes = el.classList;
			classes.remove(cls.normal, cls.selected, cls.unselected);

			if (empty) classes.add(cls.normal);
			else if (ids[idOf(item)] === true) classes.add(cls.selected);
			else classes.add(cls.unselected);
		}
	}

	/**
	 * Re-applies state classes to all items without emitting a change.
	 */
	reapplyClasses() {
		this._applyClasses();
	}

	// ──────────────────────────────────────────────────────────
	// LIFECYCLE
	// ──────────────────────────────────────────────────────────

	destroy() {
		if (this._element) {
			this._element.removeEventListener('click', this._onClick);
		}
		this._element = null;
		this.events.off();
		this._ids = Object.create(null);
		this._count = 0;
	}
}

export default Selection;