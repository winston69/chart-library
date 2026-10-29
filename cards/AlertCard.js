// ──────────────────────────────────────────────────────────────
// AlertCard.js
// ──────────────────────────────────────────────────────────────

import { CSS } from '../core/CSS.js';

const css = CSS.alertCard;
const MAX_ALERTS = 20;

const timestampFormatter = new Intl.DateTimeFormat('en-US', {
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
	hourCycle: 'h23'
});

function formatTimestamp(timestamp) {
	if (!Number.isFinite(timestamp)) return '—';
	const parts = Object.fromEntries(
		timestampFormatter.formatToParts(timestamp).map(part => [part.type, part.value])
	);
	return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export class AlertCard {
	constructor(options = {}) {
		this.id = options.id || `alerts-${Math.random().toString(36).slice(2, 8)}`;
		this.visible = options.visible !== false;
		this.maxAlerts = options.maxAlerts || MAX_ALERTS;
		this._alerts = [];
		this._elements = {
			root: null,
			list: null
		};
	}

	render(container) {
		if (!this._elements.root) this._createContent();
		this._elements.root.hidden = !this.visible;
		container.appendChild(this._elements.root);
		return this._elements.root;
	}

	addAlert(alert) {
		if (!alert) return;
		this._alerts.unshift(alert);
		if (this._alerts.length > this.maxAlerts) this._alerts.length = this.maxAlerts;

		const list = this._elements.list;
		if (!list) return;
		list.insertBefore(this._createAlert(alert, true), list.firstChild);
		if (list.children.length > this.maxAlerts) {
			list.removeChild(list.lastChild);
		}
	}

	clear() {
		this._alerts = [];
		if (this._elements.list) this._elements.list.replaceChildren();
	}

	setVisible(visible) {
		this.visible = Boolean(visible);
		if (this._elements.root) this._elements.root.hidden = !this.visible;
	}

	destroy() {
		const root = this._elements.root;
		if (root && root.parentNode) root.parentNode.removeChild(root);
		this._elements = { root: null, list: null };
	}

	_createContent() {
		const root = document.createElement('div');
		root.className = css.card;
		root.setAttribute('role', 'log');
		root.setAttribute('aria-live', 'polite');

		const title = document.createElement('div');
		title.className = CSS.cardTitle;
		title.textContent = 'Alerts';
		root.appendChild(title);

		const body = document.createElement('div');
		body.className = CSS.cardBody;
		const list = document.createElement('div');
		list.className = css.list;
		body.appendChild(list);
		root.appendChild(body);

		this._elements = { root, list };
		for (let i = this._alerts.length - 1; i >= 0; i--) {
			list.insertBefore(this._createAlert(this._alerts[i]), list.firstChild);
		}
	}

	_createAlert(alert, pulse = false) {
		const item = document.createElement('div');
		item.className = css.item;
		const direction = alert.direction
			|| (alert.type === 'MACD_CROSS_BULLISH' ? 'bullish'
				: alert.type === 'MACD_CROSS_BEARISH' ? 'bearish' : null);
		if (direction === 'bullish') item.classList.add(css.bullish);
		if (direction === 'bearish') item.classList.add(css.bearish);
		if (pulse) item.classList.add(css.pulse);

		const time = document.createElement('time');
		time.className = css.time;
		time.textContent = formatTimestamp(alert.time);
		item.appendChild(time);

		const message = document.createElement('span');
		message.className = css.message;
		message.textContent = alert.message;
		item.appendChild(message);
		return item;
	}
}

export default AlertCard;
