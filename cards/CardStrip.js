// ──────────────────────────────────────────────────────────────
// CardStrip.js
// ──────────────────────────────────────────────────────────────

import { Layer } from '../core/Layer.js';
import { Events } from '../core/Events.js';
import { CSS } from '../core/CSS.js';

const css = CSS.cardStrip;

export class CardStrip extends Layer {
	constructor(options = {}) {
		super({
			id: options.id,
			type: 'card-strip',
			name: options.name || 'CardStrip',
			label: options.label || 'CardStrip',
			plane: options.plane,
			onUpdate: options.onUpdate,
			onDestroy: options.onDestroy
		});

		this.slot = 'html-overlay';
		this.z = 25;

		// Layout overrides
		this._rowHeightOverride = options.rowHeight;
		this._defaultCardWidthOverride = options.defaultCardWidth;
		this._paddingOverride = options.padding;

		// Cards
		this._cards = [];

		// DOM
		this._elements = {
			container: null,
			cardEls: []
		};

		this._contentCreated = false;
		this._layoutDirty = true;
		this._itemsDirty = true;
		this._cachedPadding = undefined;
		this._cachedSize = null;

		this._unsubscribeEvents = [];
	}

	// ─── Event subscriptions ───
	_setupEventListeners() {
		if (!this.plane || !this.plane.events) return;
		const events = this.plane.events;

		const onLayout = () => { this._layoutDirty = true; };

		this._unsubscribeEvents = [
			events.on(Events.MARGINS_CHANGED, onLayout),
			events.on(Events.PLANE_RESIZED, onLayout),
			events.on(Events.FULLSCREEN_CHANGED, onLayout)
		];
	}

	_unsubscribeFromPlaneEvents() {
		for (const unsub of this._unsubscribeEvents) {
			try { unsub(); } catch (e) { /* ignore */ }
		}
		this._unsubscribeEvents = [];
	}

	// ─── Card management ───
	addCard(item) {
		if (!item || typeof item.render !== 'function') {
			throw new Error('CardStrip.addCard: card must implement render(container)');
		}
		if (this._cards.indexOf(item) !== -1) return item;

		this._cards.push(item);
		this._itemsDirty = true;
		this._layoutDirty = true;
		this._cachedSize = null;
		this._requestUpdate();
		return item;
	}

	removeCard(cardOrId) {
		const idx = typeof cardOrId === 'string'
			? this._cards.findIndex(c => c.id === cardOrId)
			: this._cards.indexOf(cardOrId);

		if (idx === -1) return this;

		const card = this._cards[idx];
		this._cards.splice(idx, 1);

		if (typeof card.destroy === 'function') {
			try { card.destroy(); } catch (e) { /* ignore */ }
		}

		this._itemsDirty = true;
		this._layoutDirty = true;
		this._requestUpdate();
		return this;
	}

	clearCards() {
		for (const card of this._cards) {
			if (typeof card.destroy === 'function') {
				try { card.destroy(); } catch (e) { /* ignore */ }
			}
		}
		this._cards = [];
		this._itemsDirty = true;
		this._layoutDirty = true;
		this._requestUpdate();
		return this;
	}

	getCards() {
		return [...this._cards];
	}

	// ─── Render ───
	render(container) {
		if (!this._contentCreated) {
			this._createContent(container);
			this._contentCreated = true;
		} else if (this._elements.container && !this._elements.container.parentNode) {
			container.appendChild(this._elements.container);
		}

		if (this._unsubscribeEvents.length === 0) {
			this._setupEventListeners();
		}

		if (this._itemsDirty) {
			this._rebuildCards();
			this._itemsDirty = false;
		}
		this._updateLayout();
		return this._elements.container;
	}

	_createContent(container) {
		this._cachedPadding = undefined;

		const el = document.createElement('div');
		el.id = `${this.id}-container`;
		el.className = css.container;

		if (this._rowHeightOverride !== undefined) {
			el.style.setProperty('--cs-row-height', `${this._rowHeightOverride}px`);
		}
		if (this._defaultCardWidthOverride !== undefined) {
			el.style.setProperty('--cs-card-width', `${this._defaultCardWidthOverride}px`);
		}
		if (this._paddingOverride !== undefined) {
			el.style.setProperty('--cs-padding', `${this._paddingOverride}px`);
		}

		container.appendChild(el);
		this._elements.container = el;
	}

	/**
	 * Diffs the card list against the DOM. Cards that are still
	 * present keep their DOM and internal state; cards added since
	 * the last rebuild are appended; cards removed are detached.
	 * Surviving cards are reordered in place to match `_cards`.
	 */
	_rebuildCards() {
		const container = this._elements.container;
		if (!container) return;

		const cards = this._cards;
		const prev = this._elements.cardEls;

		// Fast path: nothing added, nothing removed.
		// The `_cards` array is mutated only by addCard/removeCard/
		// clearCards, all of which set `_itemsDirty`. If the counts
		// match and every slot still holds the same instance, no DOM
		// work is needed.
		if (prev.length === cards.length) {
			let same = true;
			for (let i = 0, len = cards.length; i < len; i++) {
				if (prev[i].card !== cards[i]) { same = false; break; }
			}
			if (same) return;
		}

		// Build the new entries list. Reuse existing entries by
		// matching on card instance.
		const newEntries = new Array(cards.length);
		const used = new Uint8Array(prev.length);

		for (let i = 0, len = cards.length; i < len; i++) {
			const card = cards[i];

			// Position hint first — cheap and usually correct.
			if (i < prev.length && !used[i] && prev[i].card === card) {
				used[i] = 1;
				newEntries[i] = prev[i];
				continue;
			}

			// Fall back to a scan.
			let matched = false;
			for (let j = 0, plen = prev.length; j < plen; j++) {
				if (used[j]) continue;
				if (prev[j].card === card) {
					used[j] = 1;
					newEntries[i] = prev[j];
					matched = true;
					break;
				}
			}

			if (!matched) newEntries[i] = { card, el: null };
		}

		// Render any new cards into the container.
		for (let i = 0, len = newEntries.length; i < len; i++) {
			const entry = newEntries[i];
			if (entry.el) continue;

			const card = entry.card;
			const cardEl = card.render(container);
			if (!cardEl) continue;

			if (card.width !== undefined) cardEl.style.width = `${card.width}px`;
			if (!cardEl.classList.contains(css.card)) cardEl.classList.add(css.card);

			entry.el = cardEl;
		}

		// Detach DOM for cards that were removed.
		for (let i = 0, len = prev.length; i < len; i++) {
			if (used[i]) continue;
			const el = prev[i].el;
			if (el && el.parentNode === container) container.removeChild(el);
		}

		// Reorder surviving elements to match `_cards`.
		let anchor = container.firstChild;
		for (let i = 0, len = newEntries.length; i < len; i++) {
			const el = newEntries[i].el;
			if (!el) continue;
			if (el !== anchor) container.insertBefore(el, anchor);
			anchor = el.nextSibling;
		}

		this._elements.cardEls = newEntries;
	}

	// ─── Layout ───
	_updateLayout() {
		const container = this._elements.container;
		const plane = this.plane;
		if (!container || !plane) return;

		const plot = plane.getPlotArea();

		if (this._cachedPadding === undefined) {
			const v = getComputedStyle(container).getPropertyValue('--cs-padding').trim();
			const n = parseFloat(v);
			this._cachedPadding = isFinite(n) ? n : 4;
		}

		const padding = this._cachedPadding;
		container.style.left = `${plot.left + padding}px`;
		container.style.right = `${plane.width - plot.right + padding}px`;
		container.style.bottom = `${plane.height - plot.bottom + padding}px`;
		container.style.maxHeight = `${Math.max(0, plot.height - padding * 2)}px`;

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
			this._rebuildCards();
			this._itemsDirty = false;
		}

		if (this._layoutDirty) {
			this._updateLayout();
		}

		for (const card of this._cards) {
			if (typeof card.update === 'function') {
				card.update(); 
			}
		}

		this._updateCount++;
		if (this.onUpdate) this.onUpdate(this);
		return this;
	}

	forceUpdate() {
		this._cachedPadding = undefined;
		this._layoutDirty = true;
		this._itemsDirty = true;
		this._rebuildCards();
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

		for (const card of this._cards) {
			if (typeof card.destroy === 'function') {
				try { card.destroy(); } catch (e) { /* ignore */ }
			}
		}
		this._cards = [];

		super.destroy();

		if (this._elements.container && this._elements.container.parentNode) {
			this._elements.container.parentNode.removeChild(this._elements.container);
		}
		this._elements = { container: null, cardEls: [] };
		this._contentCreated = false;
		this._itemsDirty = true;
	}
}

export default CardStrip;