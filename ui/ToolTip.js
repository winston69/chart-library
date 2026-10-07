// ──────────────────────────────────────────────────────────────
// ToolTip.js
//
// A single HTML tooltip that serves the whole plane.
//
// Two modes:
//
//   1. Auto (enabled by render() when a container is provided)
//      Listens for pointerover / pointerout on the container and
//      shows a tooltip for the nearest ancestor of the pointer
//      target that carries a descriptor:
//        - element._tooltip      (string | HTMLElement | function)
//        - element.getAttribute('tooltip')  (string)
//        - element.title                    (string, fallback)
//
//      Auto placement anchors to the cursor position and flies the
//      tooltip out at one of four diagonal angles, 45°, 135°, 225°,
//      315°, at a fixed radial distance (default 32px). The angle
//      with the most room inside the container's bounds wins.
//      Preference on ties: 45, 315, 135, 225.
//
//   2. Manual
//      show(x, y, content) / move(x, y) / hide(). Used by callers
//      that position the tooltip themselves (e.g. the crosshair).
//      Manual calls take over until the next hide(). Manual
//      placement is unchanged from before: below-right of the
//      anchor with flips and clamps.
//
// Content: string → textContent; HTMLElement → appended.
// ──────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────
// ToolTip.js
// ──────────────────────────────────────────────────────────────

import { CSS } from '../core/CSS.js';

const css = CSS.tooltip;

const DEFAULT_OFFSET = 8;

// Four diagonal anchors, in preference order.
const DIAGONAL_ANGLES = [
	{ name: 'down-right', dx: 1, dy: 1, anchor: 'tl' },
	{ name: 'up-right', dx: 1, dy: -1, anchor: 'bl' },
	{ name: 'down-left', dx: -1, dy: 1, anchor: 'tr' },
	{ name: 'up-left', dx: -1, dy: -1, anchor: 'br' }
];

export class ToolTip {
	constructor(options = {}) {
		this.id = options.id || `tooltip-${Math.random().toString(36).slice(2, 8)}`;

		// Manual mode
		this.offset = options.offset !== undefined ? options.offset : DEFAULT_OFFSET;

		// Auto mode
		this._maxWidthOverride = options.autoMaxWidth;   // undefined means "use CSS"

		// Container and bounds
		this.container = options.container || null;
		this._boundsProvider = options.bounds || null;

		// DOM
		this._elements = {
			root: null,
			contentEl: null
		};
		this._contentCreated = false;
		this._visible = false;

		// State
		this._currentTrigger = null;
		this._currentContent = null;
		this._manualMode = false;
		this._anchor = { x: 0, y: 0 };
		this._cursor = { x: 0, y: 0 };

		// Handlers
		this._onPointerOver = this._onPointerOver.bind(this);
		this._onPointerOut = this._onPointerOut.bind(this);
		this._onPointerMove = this._onPointerMove.bind(this);

		this._autoEnabled = false;
	}

	// ─── Lifecycle ───
	render(container) {
		if (!this._contentCreated) {
			this._createContent();
			this._contentCreated = true;
		}
		const parent = container || this.container;
		if (parent && this._elements.root.parentNode !== parent) {
			parent.appendChild(this._elements.root);
		}
		if (parent && !this._autoEnabled) {
			this.enableAutoHover(parent);
		}
		return this._elements.root;
	}

	_createContent() {
		const root = document.createElement('div');
		root.id = this.id;
		root.className = css.container;
		root.dataset.visible = 'false';

		if (this._maxWidthOverride !== undefined) {
			root.style.setProperty('--tooltip-max-width', `${this._maxWidthOverride}px`);
		}

		this._elements.root = root;

		const contentEl = document.createElement('div');
		contentEl.className = css.content;
		root.appendChild(contentEl);
		this._elements.contentEl = contentEl;
	}

	destroy() {
		this.disableAutoHover();
		const root = this._elements.root;
		if (root && root.parentNode) root.parentNode.removeChild(root);
		this._elements = { root: null, contentEl: null };
		this._contentCreated = false;
		this._visible = false;
		this._currentTrigger = null;
		this._currentContent = null;
	}

	// ─── Auto hover ───
	enableAutoHover(container) {
		if (this._autoEnabled) return;
		this.container = container;
		container.addEventListener('pointerover', this._onPointerOver);
		container.addEventListener('pointerout', this._onPointerOut);
		container.addEventListener('pointermove', this._onPointerMove);
		this._autoEnabled = true;
	}

	disableAutoHover() {
		if (!this._autoEnabled) return;
		const container = this.container;
		if (container) {
			container.removeEventListener('pointerover', this._onPointerOver);
			container.removeEventListener('pointerout', this._onPointerOut);
			container.removeEventListener('pointermove', this._onPointerMove);
		}
		this._autoEnabled = false;
	}

	_onPointerOver(evt) {
		if (this._manualMode) return;

		const trigger = this._findTrigger(evt.target);
		if (!trigger) {
			this._currentTrigger = null;
			return;
		}

		this._updateCursor(evt);

		if (trigger === this._currentTrigger) {
			if (this._visible) this._layoutAtCursor();
			return;
		}

		this._currentTrigger = trigger;
		this._showForTrigger(trigger);
	}

	_onPointerMove(evt) {
		if (this._manualMode) return;
		if (!this._currentTrigger) return;
		if (!this._visible) return;

		this._updateCursor(evt);
		this._layoutAtCursor();
	}

	_onPointerOut(evt) {
		if (this._manualMode) return;
		if (!this._currentTrigger) return;

		if (evt.target !== this._currentTrigger &&
			!this._currentTrigger.contains(evt.target)) {
			return;
		}

		const to = evt.relatedTarget;
		if (to && this._currentTrigger.contains(to)) return;

		this._currentTrigger = null;
		this.hide();
	}

	_updateCursor(evt) {
		const container = this.container;
		if (!container) {
			this._cursor.x = evt.clientX;
			this._cursor.y = evt.clientY;
			return;
		}
		const rect = container.getBoundingClientRect();
		this._cursor.x = evt.clientX - rect.left;
		this._cursor.y = evt.clientY - rect.top;
	}

	// ─── Trigger resolution ───
	_findTrigger(el) {
		const container = this.container;
		let node = el;
		while (node && node !== container) {
			if (this._hasDescriptor(node)) return node;
			node = node.parentElement;
		}
		return null;
	}

	_hasDescriptor(el) {
		if (el._tooltip !== undefined && el._tooltip !== null) return true;
		if (el.getAttribute && el.getAttribute('tooltip')) return true;
		if (el.title) return true;
		return false;
	}

	_readDescriptor(el) {
		if (el._tooltip !== undefined && el._tooltip !== null) {
			return typeof el._tooltip === 'function' ? el._tooltip(el) : el._tooltip;
		}
		if (el.getAttribute) {
			const attr = el.getAttribute('tooltip');
			if (attr) return attr;
		}
		if (el.title) return el.title;
		return null;
	}

	// ─── Manual API ───
	show(x, y, content) {
		this._manualMode = true;
		this._anchor.x = x;
		this._anchor.y = y;
		this._setContent(content);
		this._layoutAtAnchor();
		this._setVisible(true);
	}

	move(x, y) {
		if (!this._visible || !this._manualMode) return;
		this._anchor.x = x;
		this._anchor.y = y;
		this._layoutAtAnchor();
	}

	hide() {
		this._manualMode = false;
		this._currentTrigger = null;
		this._setVisible(false);
	}

	isVisible() {
		return this._visible;
	}

	// ─── Auto show ───
	_showForTrigger(trigger) {
		const content = this._readDescriptor(trigger);
		if (content === null || content === undefined || content === '') {
			this.hide();
			return;
		}
		this._manualMode = false;
		this._setContent(content);
		this._layoutAtCursor();
		this._setVisible(true);
	}

	// ─── Visibility ───
	_setVisible(v) {
		this._visible = !!v;
		if (this._elements.root) {
			this._elements.root.dataset.visible = v ? 'true' : 'false';
		}
	}

	// ─── Content ───
	_setContent(content) {
		if (content === this._currentContent) return;
		this._currentContent = content;

		const contentEl = this._elements.contentEl;
		while (contentEl.firstChild) contentEl.removeChild(contentEl.firstChild);

		if (typeof content === 'string') {
			contentEl.textContent = content;
		} else if (content && content.nodeType === 1) {
			contentEl.appendChild(content);
		}
	}

	// ─── Layout — manual ───
	_layoutAtAnchor() {
		const root = this._elements.root;
		if (!root) return;

		root.style.left = '0px';
		root.style.top = '0px';

		const tipRect = root.getBoundingClientRect();
		const tipW = tipRect.width;
		const tipH = tipRect.height;

		const containerRect = this._containerRect();
		const bounds = this._resolveBounds(containerRect);

		const anchor = this._anchor;
		const offset = this.offset;

		let x = anchor.x + offset;
		let y = anchor.y + offset;

		if (x + tipW > bounds.right) x = anchor.x - offset - tipW;
		if (y + tipH > bounds.bottom) y = anchor.y - offset - tipH;

		x = Math.max(bounds.left, Math.min(bounds.right - tipW, x));
		y = Math.max(bounds.top, Math.min(bounds.bottom - tipH, y));

		if (!isFinite(x)) x = 0;
		if (!isFinite(y)) y = 0;

		root.style.left = `${x}px`;
		root.style.top = `${y}px`;
		root.dataset.tooltipSide = 'manual';
	}

	// ─── Layout — auto ───
	_layoutAtCursor() {
		const root = this._elements.root;
		if (!root) return;

		root.style.left = '0px';
		root.style.top = '0px';

		const tipRect = root.getBoundingClientRect();
		const tipW = tipRect.width;
		const tipH = tipRect.height;

		const containerRect = this._containerRect();
		const bounds = this._resolveBounds(containerRect);

		const cursor = this._cursor;
		const component = this.offset / 2 ** 0.5;

		let best = null;
		for (let i = 0; i < DIAGONAL_ANGLES.length; i++) {
			const angle = DIAGONAL_ANGLES[i];
			const { x, y } = this._anchorForAngle(cursor, angle, component, tipW, tipH);

			const roomRight = bounds.right - (x + tipW);
			const roomLeft = x - bounds.left;
			const roomBottom = bounds.bottom - (y + tipH);
			const roomTop = y - bounds.top;
			const room = Math.min(roomRight, roomLeft, roomBottom, roomTop);

			if (best === null || room > best.room) {
				best = { angle, x, y, room };
			}
		}

		if (!best) return;

		const cx = Math.max(bounds.left, Math.min(bounds.right - tipW, best.x));
		const cy = Math.max(bounds.top, Math.min(bounds.bottom - tipH, best.y));

		root.style.left = `${cx}px`;
		root.style.top = `${cy}px`;
		root.dataset.tooltipSide = best.angle.name;
	}

	_anchorForAngle(cursor, angle, component, tipW, tipH) {
		const dx = angle.dx * component;
		const dy = angle.dy * component;
		const ax = cursor.x + dx;
		const ay = cursor.y + dy;

		switch (angle.anchor) {
			case 'tl': return { x: ax, y: ay };
			case 'tr': return { x: ax - tipW, y: ay };
			case 'bl': return { x: ax, y: ay - tipH };
			case 'br': return { x: ax - tipW, y: ay - tipH };
			default: return { x: ax, y: ay };
		}
	}

	// ─── Utilities ───
	_containerRect() {
		const container = this.container;
		if (!container) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
		return container.getBoundingClientRect();
	}

	_resolveBounds(containerRect) {
		const provider = this._boundsProvider;
		const fallback = {
			left: 0,
			top: 0,
			right: containerRect.width,
			bottom: containerRect.height
		};
		if (!provider) return fallback;
		const raw = typeof provider === 'function' ? provider() : provider;
		if (!raw) return fallback;
		return raw;
	}
}

export default ToolTip;