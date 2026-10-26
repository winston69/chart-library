// ──────────────────────────────────────────────────────────────
// Checklist.js
//
// A multi-select dropdown that keeps its popup open while items
// are toggled. Options use the shape { value, label, checked }.
// ──────────────────────────────────────────────────────────────

import { Dropdown } from './Dropdown.js';
import { CSS } from '../core/CSS.js';

const css = CSS.dropdown;

export class Checklist extends Dropdown {
	constructor(options = {}) {
		const checklistOptions = Array.isArray(options.options)
			? options.options.map(option => ({ ...option }))
			: [];

		super({
			...options,
			options: checklistOptions,
			value: null,
			placeholder: options.placeholder || 'Indicators'
		});

		this.onChange = options.onChange || null;
	}

	_createContent() {
		super._createContent();
		this._elements.root.classList.add(css.checklistRoot);
		this._elements.popup.setAttribute('role', 'menu');
	}

	_buildItems() {
		const popup = this._elements.popup;
		if (!popup) return;

		while (popup.firstChild) popup.removeChild(popup.firstChild);
		this._elements.items = [];

		for (let i = 0; i < this.options.length; i++) {
			const option = this.options[i];
			const item = document.createElement('div');
			item.className = css.item;
			item.setAttribute('role', 'menuitemcheckbox');
			item.dataset.index = String(i);
			item.dataset.checked = option.checked ? 'true' : 'false';
			item.setAttribute('aria-checked', option.checked ? 'true' : 'false');
			item.tabIndex = -1;

			const checkbox = document.createElement('span');
			checkbox.className = css.checklistCheckbox;
			checkbox.setAttribute('aria-hidden', 'true');
			item.appendChild(checkbox);

			const label = document.createElement('span');
			label.className = css.checklistLabel;
			label.textContent = option.label;
			item.appendChild(label);

			item.addEventListener('click', () => this._onItemClick(i));
			popup.appendChild(item);
			this._elements.items.push(item);
		}
	}

	_updateSelectionClasses() {
		const items = this._elements.items;
		for (let i = 0; i < items.length; i++) {
			const checked = !!(this.options[i] && this.options[i].checked);
			items[i].classList.toggle(css.selected, checked);
			items[i].dataset.checked = checked ? 'true' : 'false';
			items[i].setAttribute('aria-checked', checked ? 'true' : 'false');
		}
	}

	_onItemClick(index) {
		const option = this.options[index];
		if (!option) return;

		this._highlightIndex = index;
		this._updateHighlight();
		this.setChecked(option.value, !option.checked, true);
	}

	setChecked(value, checked, fire = false) {
		const option = this._findOption(value);
		if (!option || !!option.checked === !!checked) return this;

		option.checked = !!checked;
		this._update();

		if (fire && this.onChange) {
			this.onChange(option.value, option.checked, option);
		}
		return this;
	}

	isChecked(value) {
		const option = this._findOption(value);
		return !!(option && option.checked);
	}

	setOptions(options) {
		this.options = Array.isArray(options)
			? options.map(option => ({ ...option }))
			: [];
		this._buildItems();
		this._update();
		return this;
	}
}

export default Checklist;
