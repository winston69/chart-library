import { CSS } from '../core/CSS.js';
import { formatNumber } from '../utils/Format.js';

const MAX_TRADES = 50;
const SIGNAL_WINDOW_MINS = 15;
const SIGNAL_DESCRIPTIONS = Object.freeze({
	'🔥': 'High volume',
	'💧': 'Low volume',
	'➖': 'Normal volume',
	'🐋': 'Whale trade',
	'📈': 'Bullish signal (MACD/breakout)',
	'📉': 'Bearish signal (MACD/breakout)',
	'⚠️': 'Warning (RSI overbought/oversold)'
});

export class TradesCard {
	constructor(options = {}) {
		this.id = options.id || `trades-${Math.random().toString(36).slice(2, 8)}`;
		this.visible = options.visible !== false;
		this._elements = {
			root: null,
			tbody: null,
			title: null,
			totalCount: null,
			buyCount: null,
			sellCount: null
		};
		this._trades = [];
		this._totalCount = 0;
		this._buyCount = 0;
		this._sellCount = 0;
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
		this._totalCount = trade.totalCount;
		this._buyCount = trade.buyCount;
		this._sellCount = trade.sellCount;
		const tbody = this._elements.tbody;
		if (!tbody) return;

		tbody.insertBefore(this._createRow(trade), tbody.firstChild);
		if (tbody.children.length > MAX_TRADES) {
			tbody.removeChild(tbody.lastChild);
		}
		this._updateTitle();
	}

	clear() {
		this._trades = [];
		this._totalCount = 0;
		this._buyCount = 0;
		this._sellCount = 0;
		if (this._elements.tbody) this._elements.tbody.replaceChildren();
		this._updateTitle();
	}

	setVisible(visible) {
		this.visible = Boolean(visible);
		if (this._elements.root) this._elements.root.hidden = !this.visible;
	}

	destroy() {
		const root = this._elements.root;
		if (root && root.parentNode) root.parentNode.removeChild(root);
		this._elements = {
			root: null,
			tbody: null,
			title: null,
			totalCount: null,
			buyCount: null,
			sellCount: null
		};
	}

	_createContent() {
		const root = document.createElement('div');
		root.className = 'trades-card';

		const title = document.createElement('div');
		title.className = `${CSS.cardTitle} trades-title`;
		const titleLabel = document.createElement('span');
		titleLabel.textContent = 'Trades: ';
		const totalCount = document.createElement('span');
		title.appendChild(titleLabel);
		title.appendChild(totalCount);
		const windowStats = document.createElement('span');
		windowStats.className = 'window-stats';
		const windowLabel = document.createElement('span');
		windowLabel.className = 'window-label';
		windowLabel.textContent = `${SIGNAL_WINDOW_MINS}m:`;
		const buyCount = document.createElement('span');
		buyCount.className = 'buy-bar';
		const separator = document.createElement('span');
		separator.className = 'window-separator';
		separator.textContent = '|';
		const sellCount = document.createElement('span');
		sellCount.className = 'sell-bar';
		windowStats.appendChild(windowLabel);
		windowStats.appendChild(buyCount);
		windowStats.appendChild(separator);
		windowStats.appendChild(sellCount);
		title.appendChild(windowStats);
		root.appendChild(title);

		const body = document.createElement('div');
		body.className = CSS.cardBody;
		const table = document.createElement('table');
		const thead = document.createElement('thead');
		const headerRow = document.createElement('tr');
		for (const label of ['Time', 'Side', 'Price', 'Value', 'AveBuy', 'AveSell', 'Sig']) {
			const header = document.createElement('th');
			header.scope = 'col';
			header.textContent = label;
			headerRow.appendChild(header);
		}
		thead.appendChild(headerRow);
		table.appendChild(thead);

		const tbody = document.createElement('tbody');
		table.appendChild(tbody);
		body.appendChild(table);
		root.appendChild(body);

		this._elements = { root, tbody, title, totalCount, buyCount, sellCount };
		this._updateTitle();
		for (let i = this._trades.length - 1; i >= 0; i--) {
			tbody.insertBefore(this._createRow(this._trades[i]), tbody.firstChild);
		}
	}

	_updateTitle() {
		if (this._elements.title) {
			this._elements.totalCount.textContent = formatNumber(this._totalCount, 0);
			this._elements.buyCount.textContent = String(this._buyCount);
			this._elements.sellCount.textContent = String(this._sellCount);
			this._elements.buyCount.style.flexGrow = String(this._buyCount);
			this._elements.sellCount.style.flexGrow = String(this._sellCount);
		}
	}

	_createRow(trade) {
		const row = document.createElement('tr');
		row.classList.add(trade.isBuyerMaker === false ? 'buy' : 'sell');
		const cells = [
			{ value: trade.time },
			{ value: trade.isBuyerMaker === false ? 'BUY' : 'SELL', className: 'side' },
			{ value: trade.price, alignment: 'align-right' },
			{ value: trade.value, alignment: 'align-right' },
			{ value: trade.aveBuyValue, alignment: 'align-right' },
			{ value: trade.aveSellValue, alignment: 'align-right' },
			{ signals: Array.isArray(trade.sig) ? trade.sig : [], alignment: 'align-center' }
		];
		for (const { value, signals, alignment, className } of cells) {
			const cell = document.createElement('td');
			if (signals) {
				for (const emoji of signals) {
					const signal = document.createElement('span');
					signal.textContent = emoji;
					signal.setAttribute('title', SIGNAL_DESCRIPTIONS[emoji] || '');
					cell.appendChild(signal);
				}
			} else {
				cell.textContent = value;
			}
			if (alignment) cell.classList.add(alignment);
			if (className) cell.classList.add(className);
			row.appendChild(cell);
		}
		return row;
	}
}

export default TradesCard;
