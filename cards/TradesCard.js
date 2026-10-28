const MAX_TRADES = 50;

export class TradesCard {
	constructor(options = {}) {
		this.id = options.id || `trades-${Math.random().toString(36).slice(2, 8)}`;
		this.visible = options.visible !== false;
		this._elements = {
			root: null,
			tbody: null
		};
		this._trades = [];
	}

	render(container) {
		if (!this._elements.root) this._createContent();
		this._elements.root.hidden = !this.visible;
		container.appendChild(this._elements.root);
		return this._elements.root;
	}

	addTrade(trade) {
		this._trades.unshift(trade);
		if (this._trades.length > MAX_TRADES) this._trades.length = MAX_TRADES;
		const tbody = this._elements.tbody;
		if (!tbody) return;

		tbody.insertBefore(this._createRow(trade), tbody.firstChild);
		if (tbody.children.length > MAX_TRADES) {
			tbody.removeChild(tbody.lastChild);
		}
	}

	clear() {
		this._trades = [];
		if (this._elements.tbody) this._elements.tbody.replaceChildren();
	}

	setVisible(visible) {
		this.visible = Boolean(visible);
		if (this._elements.root) this._elements.root.hidden = !this.visible;
	}

	destroy() {
		const root = this._elements.root;
		if (root && root.parentNode) root.parentNode.removeChild(root);
		this._elements = { root: null, tbody: null };
	}

	_createContent() {
		const root = document.createElement('div');
		root.className = 'trades-card';

		const table = document.createElement('table');
		const thead = document.createElement('thead');
		const headerRow = document.createElement('tr');
		for (const label of ['Time', 'Price', 'Value', 'Sig']) {
			const header = document.createElement('th');
			header.scope = 'col';
			header.textContent = label;
			headerRow.appendChild(header);
		}
		thead.appendChild(headerRow);
		table.appendChild(thead);

		const tbody = document.createElement('tbody');
		table.appendChild(tbody);
		root.appendChild(table);

		this._elements = { root, tbody };
		for (let i = this._trades.length - 1; i >= 0; i--) {
			tbody.insertBefore(this._createRow(this._trades[i]), tbody.firstChild);
		}
	}

	_createRow(trade) {
		const row = document.createElement('tr');
		row.classList.add(trade.isBuyerMaker === false ? 'buy' : 'sell');
		const average = trade.isBuyerMaker ? trade.aveSell : trade.aveBuy;
		const difference = trade.qty - average;
		const tolerance = Number.EPSILON * Math.max(1, Math.abs(trade.qty), Math.abs(average)) * 4;
		const signal = Math.abs(difference) <= tolerance
			? '➖'
			: difference > 0 ? '🔥' : '💧';
		const cells = [
			{ value: trade.time },
			{ value: trade.price, alignment: 'align-right' },
			{ value: trade.value, alignment: 'align-right' },
			{ value: signal, alignment: 'align-center' }
		];
		for (const { value, alignment } of cells) {
			const cell = document.createElement('td');
			cell.textContent = value;
			if (alignment) cell.classList.add(alignment);
			row.appendChild(cell);
		}
		return row;
	}
}

export default TradesCard;
