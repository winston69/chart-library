// ──────────────────────────────────────────────────────────────
// OHLCCard.js
//
// A CardStrip card showing Open / High / Low / Close for the candle
// under the crosshair, or the latest candle when the crosshair is
// not over the source layer's band.
//
// Field names are capitalized ('Open', 'High', ...) to match the
// display labels exactly, avoiding any case transforms at runtime.
//
// Implements the CardStrip card interface:
//   id, width, render(container), update(), destroy()
// ──────────────────────────────────────────────────────────────

const DEFAULT_WIDTH = 140;

const FIELDS = ['Open', 'High', 'Low', 'Close'];

export class OHLCCard {
	constructor(options = {}) {
		this.id = options.id || `ohlc-${Math.random().toString(36).slice(2, 8)}`;
		this.plane = options.plane || null;

		// ─── SOURCE ───
		this.layer = options.layer || null;          // CandleStick
		this.crosshair = options.crosshair || null;  // reserved for future direct subscription

		// ─── DISPLAY ───
		this.title = options.title || (this.layer && (this.layer.label || this.layer.name)) || 'OHLC';
		this.width = options.width || DEFAULT_WIDTH;
		this.decimals = options.decimals !== undefined
			? options.decimals
			: (this.layer && this.layer.decimals !== undefined ? this.layer.decimals : 2);

		// ─── ITEMS ───
		// One entry per field. Each entry holds the current value (for
		// diffing), the DOM element for the value text, and any other
		// per-field state we want to keep.
		this.items = Object.assign(Object.create(null),{
			Open: { value: null, e: null },
			High: { value: null, e: null },
			Low: { value: null, e: null },
			Close: { value: null, e: null }
		});

		// ─── STATE ───
		this._hoveredSample = null;    // { Open, High, Low, Close, x } or null
		this._lastDirection = null;    // 'up' | 'down' | null — for class diffing

		// ─── DOM ───
		this._elements = {
			root: null,
			titleEl: null,
			rowsEl: null
		};
	}

	// ──────────────────────────────────────────────────────────
	// CARD INTERFACE
	// ──────────────────────────────────────────────────────────

	render(container) {
		if (!this._elements.root) {
			this._createContent();
		}
		container.appendChild(this._elements.root);
		this._applyValues();
		return this._elements.root;
	}

	update() {
		// Plane pass. If not hovering, re-read the latest candle and
		// apply if the values changed.
		if (!this._hoveredSample) {
			this._applyValues();
		}
	}

	destroy() {
		if (this._elements.root && this._elements.root.parentNode) {
			this._elements.root.parentNode.removeChild(this._elements.root);
		}
		this._elements = { root: null, titleEl: null, rowsEl: null };
		for (const key of FIELDS) {
			this.items[key].e = null;
			this.items[key].value = null;
		}
		this._hoveredSample = null;
		this._lastDirection = null;
	}

	// ──────────────────────────────────────────────────────────
	// DOM
	// ──────────────────────────────────────────────────────────

	_createContent() {
		const root = document.createElement('div');
		root.className = 'ohlc-card';

		const titleEl = document.createElement('div');
		titleEl.className = 'ohlc-title';
		titleEl.textContent = this.title;
		root.appendChild(titleEl);
		this._elements.titleEl = titleEl;

		const rowsEl = document.createElement('div');
		rowsEl.className = 'ohlc-rows';
		root.appendChild(rowsEl);
		this._elements.rowsEl = rowsEl;

		for (const key of FIELDS) {
			const row = document.createElement('div');
			row.className = 'ohlc-row';

			const label = document.createElement('span');
			label.className = 'ohlc-label';
			label.textContent = key;
			row.appendChild(label);

			const value = document.createElement('span');
			value.className = 'ohlc-value';
			row.appendChild(value);

			rowsEl.appendChild(row);

			// Store the value element on the item for later direct writes.
			this.items[key].e = value;
		}

		this._elements.root = root;
	}

	// ──────────────────────────────────────────────────────────
	// VALUES
	// ──────────────────────────────────────────────────────────

	/**
	 * Resolves the current values: the hovered sample if present,
	 * otherwise the latest candle from the source layer.
	 *
	 * @returns {{ Open: number, High: number, Low: number, Close: number }|null}
	 */
	_getSource() {
		if (this._hoveredSample) return this._hoveredSample;
		if (!this.layer) return null;

		const data = this.layer.getData ? this.layer.getData() : null;
		if (!data || data.length === 0) return null;

		const last = data[data.length - 1];
		return {
			Open: this.layer.openAccessor(last),
			High: this.layer.highAccessor(last),
			Low: this.layer.lowAccessor(last),
			Close: this.layer.closeAccessor(last)
		};
	}

	/**
	 * Writes the current OHLC values into the DOM, skipping fields
	 * whose value hasn't changed since the last write.
	 */
	_applyValues() {
		const src = this._getSource();

		if (!src) {
			for (const key of FIELDS) {
				const item = this.items[key];
				if (item.value !== null) {
					item.value = null;
					if (item.e) item.e.textContent = '—';
				}
			}
			this._applyDirection(null);
			return;
		}

		const decimals = this.decimals;
		for (const key of FIELDS) {
			const v = src[key];
			const item = this.items[key];
			if (!isFinite(v)) {
				if (item.value !== null) {
					item.value = null;
					if (item.e) item.e.textContent = '—';
				}
				continue;
			}
			if (item.value !== v) {
				item.value = v;
				if (item.e) item.e.textContent = v.toFixed(decimals);
			}
		}

		// Direction class only changes when close vs open flips.
		const isUp = src.Close >= src.Open;
		this._applyDirection(isUp ? 'up' : 'down');
	}

	_applyDirection(dir) {
		if (this._lastDirection === dir) return;
		this._lastDirection = dir;

		const root = this._elements.root;
		if (!root) return;

		root.classList.toggle('ohlc-up', dir === 'up');
		root.classList.toggle('ohlc-down', dir === 'down');
	}

	// ──────────────────────────────────────────────────────────
	// CROSSHAIR HOOK
	// ──────────────────────────────────────────────────────────

	/**
	 * Called by the wiring layer when the crosshair moves. If the
	 * crosshair snapped to a sample on this card's source layer, show
	 * that candle's OHLC. Otherwise show the latest.
	 *
	 * @param {object|null} payload
	 */
	onCrosshairMove(payload) {
		if (!payload ||
			payload.snapSource !== this.layer ||
			!payload.snapSample) {
			if (this._hoveredSample) {
				this._hoveredSample = null;
				this._applyValues();
			}
			return;
		}

		const data = this.layer.getData ? this.layer.getData() : null;
		const datum = data && data[payload.snapSample.index];
		if (!datum) {
			if (this._hoveredSample) {
				this._hoveredSample = null;
				this._applyValues();
			}
			return;
		}

		const x = this.layer.xAccessor(datum);
		if (this._hoveredSample && this._hoveredSample.x === x) {
			// Same candle; values unchanged.
			return;
		}

		this._hoveredSample = {
			Open: this.layer.openAccessor(datum),
			High: this.layer.highAccessor(datum),
			Low: this.layer.lowAccessor(datum),
			Close: this.layer.closeAccessor(datum),
			x
		};

		this._applyValues();
	}
}

export default OHLCCard;