// ──────────────────────────────────────────────────────────────
// InfoCard.js
// ──────────────────────────────────────────────────────────────

const DEFAULT_WIDTH = 140;

const FIELDS = [
	{ key: 'points', icon: '⋯', label: 'Points', format: v => v },
	{ key: 'yScale', icon: '↕', label: 'Y Scale', format: (v, d) => v.toFixed(d) },
	{ key: 'min', icon: '▽', label: 'Min', format: (v, d) => v.toFixed(d) },
	{ key: 'max', icon: '△', label: 'Max', format: (v, d) => v.toFixed(d) },
	{ key: 'range', icon: '↔', label: 'Range', format: (v, d) => v.toFixed(d) },
	{ key: 'lastY', icon: '★', label: 'Last', format: (v, d) => v.toFixed(d) }
];

export class InfoCard {
	constructor(options = {}) {
		this.id = options.id || `info-${Math.random().toString(36).slice(2, 8)}`;
		this.plane = options.plane || null;
		this.layer = options.layer || null;

		this.title = options.title || null;
		this.width = options.width || DEFAULT_WIDTH;

		this.items = Object.create(null);
		for (let i = 0; i < FIELDS.length; i++) {
			const f = FIELDS[i];
			this.items[f.key] = {
				format: f.format,
				value: null,
				valueEl: null
			};
		}

		this._root = null;
	}

	// ─── Card interface ───
	render(container) {
		if (!this._root) this._createContent();
		container.appendChild(this._root);
		this.update();
		return this._root;
	}

	update() {
		if (!this._root) return;

		const layer = this.layer;
		if (!layer || !layer.getStats) return;

		const s = layer.getStats();
		const data = layer.getData ? layer.getData() : null;
		const plotHeight = this.plane ? this.plane.plotHeight : 0;
		const decimals = layer.decimals !== undefined ? layer.decimals : 2;

		const raw = {
			points: data ? data.length : 0,
			yScale: (s.hasData && plotHeight) ? ((s.yMax - s.yMin) / plotHeight * 100) : null,
			min: s.hasData ? s.yMin : null,
			max: s.hasData ? s.yMax : null,
			range: s.hasData ? (s.yMax - s.yMin) : null,
			lastY: (s.hasData && s.lastY !== null) ? s.lastY : null
		};

		for (let i = 0; i < FIELDS.length; i++) {
			const key = FIELDS[i].key;
			const item = this.items[key];
			if (!item.valueEl) continue;

			const v = raw[key];
			const display = (v === null || v === undefined || !isFinite(v))
				? '-'
				: item.format(v, decimals);

			if (item.value === display) continue;
			item.value = display;
			item.valueEl.textContent = display;
		}
	}

	destroy() {
		if (this._root && this._root.parentNode) {
			this._root.parentNode.removeChild(this._root);
		}
		this._root = null;
		for (const key in this.items) {
			this.items[key].valueEl = null;
			this.items[key].value = null;
		}
	}

	// ─── DOM ───
	_createContent() {
		const root = document.createElement('div');
		root.className = 'info-card';

		if (this.title) {
			const titleEl = document.createElement('div');
			titleEl.className = 'info-title';
			titleEl.textContent = this.title;
			root.appendChild(titleEl);
		}

		const gridEl = document.createElement('div');
		gridEl.className = 'info-grid';
		root.appendChild(gridEl);

		for (let i = 0; i < FIELDS.length; i++) {
			const f = FIELDS[i];
			const item = this.items[f.key];

			const cell = document.createElement('div');
			cell.className = 'info-cell';
			cell.setAttribute('tooltip', f.label);

			const icon = document.createElement('span');
			icon.className = 'info-icon';
			icon.textContent = f.icon;
			cell.appendChild(icon);

			const value = document.createElement('span');
			value.className = 'info-value';
			cell.appendChild(value);

			gridEl.appendChild(cell);
			item.valueEl = value;
		}

		this._root = root;
	}
}

export default InfoCard;