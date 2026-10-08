// ──────────────────────────────────────────────────────────────
// Button.js
//
// HTML button with optional icon, label, shortcut, and variant/size
// styling. Renders into any HTML container.
//
// Tooltips are provided by the shared ToolTip: this class simply
// sets the `tooltip` attribute on its root element when a tooltip
// option is supplied. The shared ToolTip's auto-hover reads it.
//
// Public API:
//   render(container) → HTMLElement
//   update()
//   getElement() → HTMLElement
//   getBBox()    → { width, height }
//   setSelected / toggleSelected
//   setDisabled / setActive
//   setLabel / setIcon / setTooltip / setSize / setVariant
//   getData / setData
//   destroy()
// ──────────────────────────────────────────────────────────────

import { CSS } from '../core/CSS.js';
import { Icons } from '../core/Icons.js';

const css = CSS.button;

export class Button {
	constructor(options = {}) {
		// ─── IDENTITY ───
		this.id = options.id || `btn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

		// ─── CONTENT ───
		this.label = options.label || '';
		this.icon = options.icon || null;
		this.shortcut = options.shortcut || null;

		// ─── STYLING ───
		this.size = options.size || 'md';
		this.variant = options.variant || 'secondary';

		// ─── STATE ───
		this.selected = options.selected || false;
		this.disabled = options.disabled || false;
		this.active = options.active || false;
		this._lastIconSpec = null;

		// ─── TOOLTIP ───
		// Plain string, HTMLElement, or function. Set as the `tooltip`
		// attribute for string/HTMLElement; as `_tooltip` property for
		// function (since functions can't be attribute values).
		this.tooltip = options.tooltip || null;

		// ─── EVENTS ───
		this.onClick = options.onClick || null;
		this.onHover = options.onHover || null;
		this.onBlur = options.onBlur || null;

		// ─── ACCESSIBILITY ───
		this.ariaLabel = options.ariaLabel || this.label || (typeof this.tooltip === 'string' ? this.tooltip : null);

		// ─── DOM ───
		this._elements = {
			root: null,
			iconEl: null,
			labelEl: null,
			shortcutEl: null
		};
		this._contentCreated = false;
		this._isHovering = false;

		// ─── CUSTOM DATA ───
		this.data = options.data || {};
	}

	// ──────────────────────────────────────────────────────────
	// RENDER
	// ──────────────────────────────────────────────────────────

	render(container) {
		if (!this._contentCreated) {
			this._createElement();
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

	_createElement() {
		const el = this._elements;

		// ─── ROOT ───
		const root = document.createElement('div');
		root.id = this.id;
		root.className = this._getClasses();
		root.setAttribute('role', 'button');
		root.setAttribute('tabindex', '0');
		if (this.ariaLabel) root.setAttribute('aria-label', this.ariaLabel);
		root.dataset.selected = this.selected ? 'true' : 'false';
		root.dataset.disabled = this.disabled ? 'true' : 'false';
		root.dataset.hover = 'false';
		el.root = root;

		this._applyTooltip(root);

		// ─── ICON ───
		if (this.icon) {
			const iconEl = Icons.create(this.icon);
			if (iconEl) {
				root.appendChild(iconEl);
				el.iconEl = iconEl;
				this._lastIconSpec = this.icon;
			}
		}

		// ─── LABEL ───
		if (this.label) {
			const labelEl = document.createElement('span');
			labelEl.className = css.label;
			labelEl.textContent = this.label;
			root.appendChild(labelEl);
			el.labelEl = labelEl;
		}

		// ─── SHORTCUT ───
		if (this.shortcut) {
			const shortcutEl = document.createElement('span');
			shortcutEl.className = css.shortcut;
			shortcutEl.textContent = this.shortcut;
			root.appendChild(shortcutEl);
			el.shortcutEl = shortcutEl;
		}

		this._bindEvents();
	}

	_bindEvents() {
		const root = this._elements.root;

		root.addEventListener('click', (e) => {
			if (this.disabled) return;
			if (this.onClick) this.onClick(e, this);
		});

		root.addEventListener('keydown', (e) => {
			if (this.disabled) return;
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				if (this.onClick) this.onClick(e, this);
			}
		});

		root.addEventListener('mouseenter', (e) => {
			if (this.disabled) return;
			this._isHovering = true;
			this._updateHover(true);
			if (this.onHover) this.onHover(e, this);
		});

		root.addEventListener('mouseleave', (e) => {
			this._isHovering = false;
			this._updateHover(false);
			if (this.onBlur) this.onBlur(e, this);
		});
	}

	// ──────────────────────────────────────────────────────────
	// TOOLTIP
	// ──────────────────────────────────────────────────────────

	/**
	 * Applies the current tooltip to the root element.
	 * String / HTMLElement → `tooltip` attribute won't work for
	 * HTMLElement (can't stringify). Functions can't be attribute
	 * values either. So:
	 *   - string: set `tooltip` attribute.
	 *   - HTMLElement: set `_tooltip` property on the root.
	 *   - function: set `_tooltip` property on the root.
	 */
	_applyTooltip(root) {
		const tip = this.tooltip;

		// Clear prior state.
		root.removeAttribute('tooltip');
		delete root._tooltip;

		if (!tip) return;

		if (typeof tip === 'string') {
			root.setAttribute('tooltip', tip);
		} else {
			// HTMLElement or function.
			root._tooltip = tip;
		}
	}

	// ──────────────────────────────────────────────────────────
	// UPDATE
	// ──────────────────────────────────────────────────────────

	update() {
		if (!this._contentCreated) return this;
		this._update();
		return this;
	}

	_update() {
		const el = this._elements;
		const root = el.root;
		if (!root) return;

		root.className = this._getClasses();
		root.dataset.selected = this.selected ? 'true' : 'false';
		root.dataset.disabled = this.disabled ? 'true' : 'false';

		// Label
		if (el.labelEl && el.labelEl.textContent !== this.label) {
			el.labelEl.textContent = this.label;
		}

		// Icon — rebuild when the spec changes.
		if (el.iconEl && this.icon !== this._lastIconSpec) {
			const fresh = Icons.create(this.icon);
			if (fresh) {
				el.iconEl.replaceWith(fresh);
				el.iconEl = fresh;
				this._lastIconSpec = this.icon;
			}
		}

		// Shortcut
		if (el.shortcutEl && el.shortcutEl.textContent !== this.shortcut) {
			el.shortcutEl.textContent = this.shortcut || '';
		}

		if (this._isHovering) this._updateHover(true);
	}

	// ──────────────────────────────────────────────────────────
	// HOVER
	// ──────────────────────────────────────────────────────────

	_updateHover(isHovering) {
		const root = this._elements.root;
		if (!root) return;
		root.dataset.hover = (isHovering && !this.disabled) ? 'true' : 'false';
	}

	// ──────────────────────────────────────────────────────────
	// CLASSES
	// ──────────────────────────────────────────────────────────

	_getClasses() {
		const parts = [css.btn];

		if (this.variant) parts.push('btn-' + this.variant);
		if (this.size) parts.push('btn-' + this.size);
		if (this.selected) parts.push(css.selected);
		if (this.disabled) parts.push(css.disabled);
		if (this.icon && !this.label) parts.push(css.iconOnly);

		return parts.join(' ');
	}

	// ──────────────────────────────────────────────────────────
	// STATE
	// ──────────────────────────────────────────────────────────

	setSelected(selected) {
		if (this.selected === selected) return this;
		this.selected = selected;
		this.update();
		return this;
	}

	toggleSelected() {
		this.selected = !this.selected;
		this.update();
		return this;
	}

	setDisabled(disabled) {
		if (this.disabled === disabled) return this;
		this.disabled = disabled;
		this.update();
		return this;
	}

	setActive(active) {
		if (this.active === active) return this;
		this.active = active;
		this.update();
		return this;
	}

	setLabel(label) {
		if (this.label === label) return this;
		this.label = label;
		this.update();
		return this;
	}

	setIcon(icon) {
		if (this.icon === icon) return this;
		this.icon = icon;
		this.update();
		return this;
	}

	setTooltip(tooltip) {
		if (this.tooltip === tooltip) return this;
		this.tooltip = tooltip;
		if (this._elements.root) this._applyTooltip(this._elements.root);
		return this;
	}

	setSize(size) {
		if (this.size === size) return this;
		this.size = size;
		this.update();
		return this;
	}

	setVariant(variant) {
		if (this.variant === variant) return this;
		this.variant = variant;
		this.update();
		return this;
	}

	// ──────────────────────────────────────────────────────────
	// GETTERS
	// ──────────────────────────────────────────────────────────

	getElement() {
		return this._elements.root;
	}

	getBBox() {
		const el = this._elements.root;
		if (!el) return null;
		const rect = el.getBoundingClientRect();
		return { width: rect.width, height: rect.height };
	}

	getData(key) { return this.data[key]; }

	setData(key, value) {
		this.data[key] = value;
		return this;
	}

	// ──────────────────────────────────────────────────────────
	// DESTROY
	// ──────────────────────────────────────────────────────────

	destroy() {
		const root = this._elements.root;
		if (root && root.parentNode) root.parentNode.removeChild(root);

		this._elements = {
			root: null,
			iconEl: null,
			labelEl: null,
			shortcutEl: null
		};
		this._contentCreated = false;
	}
}

export default Button;