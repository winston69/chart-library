// ──────────────────────────────────────────────────────────────
// Dropdown.js
//
// A dropdown control: a trigger element (label + caret) and a
// floating popup listing the options. Trigger and popup are
// tightly coupled — the trigger's label reflects the current
// selection (or the placeholder), the caret reflects whether
// the popup is open, and the popup's position is computed from
// the trigger's bounding rect.
//
// The trigger is built directly, not delegated to Button. A
// dropdown trigger is a compound (label + caret) and Button
// doesn't support a right-side icon slot. Keeping the trigger
// local to this class avoids extending Button for a case
// nothing else needs.
//
// Public API:
//   render(container) → HTMLElement
//   open() / close() / toggle()
//   setValue(value, fire) / getValue()
//   setOptions(options)
//   setDisabled(bool)
//   destroy()
//
// Options:
//   id           — DOM id, auto-generated if absent
//   options      — [{ value, label }]
//   value        — initial selection; undefined/null means none
//   placeholder  — text shown when no value is selected, greyed.
//                  Should be no longer than the option labels.
//   tooltip      — string set on the trigger as the `tooltip`
//                  attribute. Read by the shared ToolTip. Static
//                  regardless of selection.
//   size         — 'sm' | 'md' | 'lg' (default 'sm')
//   variant      — 'ghost' | 'secondary' | 'primary' | ...
//                  (default 'secondary')
//   onSelect     — (value, option) => void
//   onOpen       — () => void
//   onClose      — () => void
// ──────────────────────────────────────────────────────────────

import { SVG } from '../core/SVG.js';
import { CSS } from '../core/CSS.js';
import { Icons } from '../core/Icons.js';

const css = CSS.dropdown;

const DEFAULT_SIZE = 'sm';
const DEFAULT_VARIANT = 'secondary';
const FLIP_THRESHOLD = 4;      // px of slack below the trigger

let _dropdownSeq = 0;

export class Dropdown {
	constructor(options = {}) {
		// ─── IDENTITY ───
		this.id = options.id || `dd-${++_dropdownSeq}`;

		// ─── CONTENT ───
		this.options = Array.isArray(options.options) ? options.options.slice() : [];
		this.value = options.value !== undefined ? options.value : null;
		this.placeholder = options.placeholder || null;
		this.tooltip = options.tooltip || null;

		// ─── STYLING ───
		this.size = options.size || DEFAULT_SIZE;
		this.variant = options.variant || DEFAULT_VARIANT;

		// ─── STATE ───
		this.disabled = options.disabled || false;
		this._open = false;
		this._placement = 'below';     // 'below' | 'above'
		this._highlightIndex = -1;

		// ─── CALLBACKS ───
		this.onSelect = options.onSelect || null;
		this.onOpen = options.onOpen || null;
		this.onClose = options.onClose || null;

		// ─── DOM ───
		this._elements = {
			root: null,
			trigger: null,
			labelEl: null,
			caretEl: null,
			popup: null,
			items: []
		};

		this._contentCreated = false;

		// Bound handlers so add/removeEventListener use the same
		// function reference.
		this._onTriggerClick = this._onTriggerClick.bind(this);
		this._onTriggerKeyDown = this._onTriggerKeyDown.bind(this);
		this._onDocumentPointerDown = this._onDocumentPointerDown.bind(this);
		this._onDocumentKeyDown = this._onDocumentKeyDown.bind(this);
	}

	// ──────────────────────────────────────────────────────────
	// RENDER
	// ──────────────────────────────────────────────────────────

	render(container) {
		if (!this._contentCreated) {
			this._createContent();
			this._contentCreated = true;
		}

		if (container) {
			if (typeof container === 'string') container = document.querySelector(container);
			if (container && container.appendChild) {
				container.appendChild(this._elements.root);
			}
		}

		this._update();
		return this._elements.root;
	}

	_createContent() {
		const root = document.createElement('div');
		root.id = `${this.id}-root`;
		root.className = css.root;
		this._elements.root = root;

		// ─── TRIGGER ───
		const trigger = document.createElement('div');
		trigger.id = `${this.id}-trigger`;
		trigger.className = `${css.trigger} btn btn-${this.variant} btn-${this.size}`;
		trigger.setAttribute('role', 'button');
		trigger.setAttribute('tabindex', '0');
		if (this.tooltip) trigger.setAttribute('tooltip', this.tooltip);
		trigger.dataset.disabled = this.disabled ? 'true' : 'false';
		trigger.dataset.open = 'false';
		trigger.addEventListener('click', this._onTriggerClick);
		trigger.addEventListener('keydown', this._onTriggerKeyDown);

		const labelEl = document.createElement('span');
		labelEl.className = css.triggerLabel;
		trigger.appendChild(labelEl);
		this._elements.labelEl = labelEl;

		const caretEl = Icons.create('caretDown');
		if (caretEl) {
			caretEl.classList.add(css.caret);
			trigger.appendChild(caretEl);
			this._elements.caretEl = caretEl;
		}

		root.appendChild(trigger);
		this._elements.trigger = trigger;

		// ─── POPUP ───
		const popup = document.createElement('div');
		popup.id = `${this.id}-popup`;
		popup.className = css.popup;
		popup.setAttribute('role', 'listbox');
		popup.hidden = true;
		root.appendChild(popup);
		this._elements.popup = popup;

		this._buildItems();
	}

	_buildItems() {
		const popup = this._elements.popup;
		if (!popup) return;

		// Clear existing items.
		while (popup.firstChild) popup.removeChild(popup.firstChild);
		this._elements.items = [];

		for (let i = 0, len = this.options.length; i < len; i++) {
			const opt = this.options[i];
			const item = document.createElement('div');
			item.className = css.item;
			item.setAttribute('role', 'option');
			item.dataset.index = String(i);
			item.textContent = opt.label;

			item.addEventListener('click', () => this._onItemClick(i));

			popup.appendChild(item);
			this._elements.items.push(item);
		}
	}

	// ──────────────────────────────────────────────────────────
	// UPDATE
	// ──────────────────────────────────────────────────────────

	_update() {
		const el = this._elements;
		if (!el.trigger) return;

		const selectedOption = this._findOption(this.value);
		let labelText;
		let isPlaceholder = false;

		if (selectedOption) {
			labelText = selectedOption.label;
		} else if (this.placeholder) {
			labelText = this.placeholder;
			isPlaceholder = true;
		} else {
			labelText = '';
		}

		if (el.labelEl.textContent !== labelText) {
			el.labelEl.textContent = labelText;
		}

		el.trigger.dataset.placeholder = isPlaceholder ? 'true' : 'false';
		el.trigger.dataset.disabled = this.disabled ? 'true' : 'false';
		el.trigger.dataset.open = this._open ? 'true' : 'false';

		this._updateSelectionClasses();
	}

	_updateSelectionClasses() {
		const items = this._elements.items;
		for (let i = 0, len = items.length; i < len; i++) {
			const item = items[i];
			const opt = this.options[i];
			const isSelected = opt && this._isSameValue(opt.value, this.value);
			item.classList.toggle(css.selected, !!isSelected);
			item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
		}
	}

	_updateHighlight() {
		const items = this._elements.items;
		for (let i = 0, len = items.length; i < len; i++) {
			const item = items[i];
			item.classList.toggle(css.highlighted, i === this._highlightIndex);
		}
	}

	_findOption(value) {
		for (let i = 0, len = this.options.length; i < len; i++) {
			if (this._isSameValue(this.options[i].value, value)) return this.options[i];
		}
		return null;
	}

	_isSameValue(a, b) {
		// Values may be numbers, strings, or objects. Compare with
		// strict equality, plus a NaN check so NaN === NaN works.
		if (a === b) return true;
		if (typeof a === 'number' && typeof b === 'number' &&
			isNaN(a) && isNaN(b)) return true;
		return false;
	}

	// ──────────────────────────────────────────────────────────
	// TRIGGER EVENTS
	// ──────────────────────────────────────────────────────────

	_onTriggerClick(e) {
		if (this.disabled) return;
		e.preventDefault();
		this.toggle();
	}

	_onTriggerKeyDown(e) {
		if (this.disabled) return;

		if (e.key === 'ArrowDown' || e.key === 'ArrowUp' ||
			e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			if (!this._open) this.open();
			else if (e.key === 'ArrowDown') this._moveHighlight(1);
			else if (e.key === 'ArrowUp') this._moveHighlight(-1);
			else this._commitHighlight();
		} else if (e.key === 'Escape') {
			if (this._open) {
				e.preventDefault();
				this.close();
			}
		}
	}

	// ──────────────────────────────────────────────────────────
	// DOCUMENT-LEVEL LISTENERS
	// ──────────────────────────────────────────────────────────

	_onDocumentPointerDown(e) {
		if (!this._open) return;
		const root = this._elements.root;
		if (root && !root.contains(e.target)) {
			this.close();
		}
	}

	_onDocumentKeyDown(e) {
		if (!this._open) return;

		if (e.key === 'Escape') {
			e.preventDefault();
			this.close();
			this._elements.trigger.focus();
			return;
		}

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			this._moveHighlight(1);
			return;
		}

		if (e.key === 'ArrowUp') {
			e.preventDefault();
			this._moveHighlight(-1);
			return;
		}

		if (e.key === 'Enter') {
			e.preventDefault();
			this._commitHighlight();
			return;
		}
	}

	// ──────────────────────────────────────────────────────────
	// OPEN / CLOSE
	// ──────────────────────────────────────────────────────────

	open() {
		if (this._open || this.disabled) return this;
		if (this.options.length === 0) return this;

		this._open = true;
		this._highlightIndex = this._indexOfValue(this.value);
		if (this._highlightIndex < 0) this._highlightIndex = 0;

		this._updateHighlight();
		this._positionPopup();
		this._elements.popup.hidden = false;
		this._elements.trigger.dataset.open = 'true';

		// Defer adding document-level listeners so the click that
		// opened the popup doesn't immediately close it.
		setTimeout(() => {
			if (!this._open) return;
			document.addEventListener('pointerdown', this._onDocumentPointerDown, true);
			document.addEventListener('keydown', this._onDocumentKeyDown, true);
		}, 0);

		if (this.onOpen) this.onOpen();
		return this;
	}

	close() {
		if (!this._open) return this;

		this._open = false;
		this._elements.popup.hidden = true;
		this._elements.trigger.dataset.open = 'false';
		this._highlightIndex = -1;

		document.removeEventListener('pointerdown', this._onDocumentPointerDown, true);
		document.removeEventListener('keydown', this._onDocumentKeyDown, true);

		if (this.onClose) this.onClose();
		return this;
	}

	toggle() {
		return this._open ? this.close() : this.open();
	}

	// ──────────────────────────────────────────────────────────
	// HIGHLIGHT / SELECTION
	// ──────────────────────────────────────────────────────────

	_indexOfValue(value) {
		for (let i = 0, len = this.options.length; i < len; i++) {
			if (this._isSameValue(this.options[i].value, value)) return i;
		}
		return -1;
	}

	_moveHighlight(delta) {
		const len = this.options.length;
		if (len === 0) return;
		let i = this._highlightIndex + delta;
		if (i < 0) i = len - 1;
		if (i >= len) i = 0;
		this._highlightIndex = i;
		this._updateHighlight();
		this._scrollItemIntoView(i);
	}

	_scrollItemIntoView(i) {
		const item = this._elements.items[i];
		if (!item || typeof item.scrollIntoView !== 'function') return;
		item.scrollIntoView({ block: 'nearest' });
	}

	_commitHighlight() {
		if (this._highlightIndex < 0) return;
		this._onItemClick(this._highlightIndex);
	}

	_onItemClick(index) {
		const opt = this.options[index];
		if (!opt) return;
		this.setValue(opt.value, true);
		this.close();
		this._elements.trigger.focus();
	}

	// ──────────────────────────────────────────────────────────
	// PUBLIC SETTERS
	// ──────────────────────────────────────────────────────────

	/**
	 * Set the current selection. If `fire` is true, calls
	 * onSelect with the new value and option.
	 */
	setValue(value, fire = false) {
		if (this._isSameValue(value, this.value)) return this;
		this.value = value;
		this._update();

		if (fire && this.onSelect) {
			const opt = this._findOption(value);
			this.onSelect(value, opt);
		}
		return this;
	}

	getValue() {
		return this.value;
	}

	setOptions(options) {
		this.options = Array.isArray(options) ? options.slice() : [];
		this._buildItems();
		this._update();
		return this;
	}

	setDisabled(disabled) {
		if (this.disabled === disabled) return this;
		this.disabled = disabled;
		if (this.disabled && this._open) this.close();
		this._update();
		return this;
	}

	setTooltip(tooltip) {
		if (this.tooltip === tooltip) return this;
		this.tooltip = tooltip;
		const trigger = this._elements.trigger;
		if (!trigger) return this;
		if (tooltip) trigger.setAttribute('tooltip', tooltip);
		else trigger.removeAttribute('tooltip');
		return this;
	}

	getElement() {
		return this._elements.root;
	}

	// ──────────────────────────────────────────────────────────
	// POSITIONING
	// ──────────────────────────────────────────────────────────

	_positionPopup() {
		const el = this._elements;
		const trigger = el.trigger;
		const popup = el.popup;
		if (!trigger || !popup) return;

		// Make sure the popup is laid out so we can measure it.
		popup.style.visibility = 'hidden';
		popup.hidden = false;

		const triggerRect = trigger.getBoundingClientRect();
		const popupRect = popup.getBoundingClientRect();
		const spaceBelow = window.innerHeight - triggerRect.bottom - FLIP_THRESHOLD;
		const spaceAbove = triggerRect.top - FLIP_THRESHOLD;

		let placement = 'below';
		if (popupRect.height > spaceBelow && spaceAbove > spaceBelow) {
			placement = 'above';
		}
		this._placement = placement;

		popup.dataset.placement = placement;

		// Swap the caret icon to match the placement.
		this._updateCaretIcon(placement);

		popup.style.visibility = '';
	}

	_updateCaretIcon(placement) {
		const el = this._elements;
		if (!el.caretEl) return;

		const desired = placement === 'above' ? 'caretUp' : 'caretDown';
		// Rebuild the caret element if the spec changed. Icons.create
		// returns a fresh element; the class must be reapplied.
		const fresh = Icons.create(desired);
		if (!fresh) return;
		fresh.classList.add(css.caret);
		el.caretEl.replaceWith(fresh);
		el.caretEl = fresh;
	}

	// ──────────────────────────────────────────────────────────
	// DESTROY
	// ──────────────────────────────────────────────────────────

	destroy() {
		this.close();

		const el = this._elements;
		if (el.trigger) {
			el.trigger.removeEventListener('click', this._onTriggerClick);
			el.trigger.removeEventListener('keydown', this._onTriggerKeyDown);
		}
		if (el.root && el.root.parentNode) {
			el.root.parentNode.removeChild(el.root);
		}

		this._elements = {
			root: null,
			trigger: null,
			labelEl: null,
			caretEl: null,
			popup: null,
			items: []
		};
		this._contentCreated = false;
		this._open = false;
		this._highlightIndex = -1;
	}
}

export default Dropdown;