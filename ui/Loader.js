import { CSS } from '../core/CSS.js';

const css = CSS.loader;

export class Loader {
	constructor(options = {}) {
		this.container = options.container || null;
		this._elements = {
			root: null,
			message: null
		};

		if (!this.container) {
			throw new Error('Loader requires a chart container.');
		}

		this._createContent();
		this.container.appendChild(this._elements.root);
	}

	_createContent() {
		const root = document.createElement('div');
		root.className = css.container;
		root.dataset.visible = 'false';
		root.setAttribute('role', 'status');
		root.setAttribute('aria-live', 'polite');
		root.setAttribute('aria-busy', 'false');

		const spinner = document.createElement('div');
		spinner.className = css.spinner;
		spinner.setAttribute('aria-hidden', 'true');
		root.appendChild(spinner);

		const message = document.createElement('div');
		message.className = css.message;
		root.appendChild(message);

		this._elements = { root, message };
	}

	show(message = '') {
		const root = this._elements.root;
		this._elements.message.textContent = message;
		root.dataset.visible = 'true';
		root.setAttribute('aria-busy', 'true');
	}

	hide() {
		const root = this._elements.root;
		root.dataset.visible = 'false';
		root.setAttribute('aria-busy', 'false');
	}
}
