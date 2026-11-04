import test from 'node:test';
import assert from 'node:assert/strict';
import { AlertCard } from '../cards/AlertCard.js';

class Element {
	constructor(tagName) {
		this.tagName = tagName;
		this.children = [];
		this.textContent = '';
		this.className = '';
		this.classNames = new Set();
		this.attributes = new Map();
		this.hidden = false;
		this.classList = {
			add: name => this.classNames.add(name),
			contains: name => this.classNames.has(name)
		};
	}

	setAttribute(name, value) {
		this.attributes.set(name, value);
	}

	appendChild(child) {
		this.children.push(child);
		child.parentNode = this;
		return child;
	}

	insertBefore(child, reference) {
		const index = reference ? this.children.indexOf(reference) : -1;
		if (index === -1) this.children.push(child);
		else this.children.splice(index, 0, child);
		child.parentNode = this;
		return child;
	}

	removeChild(child) {
		const index = this.children.indexOf(child);
		if (index !== -1) this.children.splice(index, 1);
		child.parentNode = null;
		return child;
	}

	replaceChildren(...children) {
		this.children = [];
		for (const child of children) this.appendChild(child);
	}

	get firstChild() {
		return this.children[0] || null;
	}

	get lastChild() {
		return this.children.at(-1) || null;
	}
}

test('AlertCard prepends alerts and styles bullish and bearish events', t => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
	globalThis.document = { createElement: tagName => new Element(tagName) };
	t.after(() => {
		if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
		else delete globalThis.document;
	});

	const card = new AlertCard({ maxAlerts: 2 });
	card.render(new Element('div'));
	assert.equal(card._elements.title.textContent, 'Alerts (0)');
	card.addAlert({
		type: 'MACD_CROSS_BULLISH',
		source: 'macd',
		time: Date.UTC(2026, 0, 2, 3, 4, 5),
		message: 'Crossed above Signal'
	});
	card.addAlert({
		type: 'MACD_CROSS_BEARISH',
		source: 'macd',
		time: Date.UTC(2026, 0, 2, 3, 5, 5),
		message: 'Crossed below Signal'
	});

	assert.equal(card._elements.root.children[0].className, 'card-title');
	assert.equal(card._elements.root.children[0].textContent, 'Alerts (2)');
	assert.equal(card._elements.list.parentNode.className, 'card-body');
	assert.equal(card._elements.list.children.length, 2);
	assert.equal(card._elements.list.children[0].classList.contains('bearish'), true);

	assert.equal(card._elements.list.children[0].classList.contains('alert-pulse'), true);
	assert.match(card._elements.list.children[0].children[0].textContent, /^\d{2}:\d{2}:\d{2}$/);
	assert.equal(card._elements.list.children[0].attributes.has('title'), false);
	assert.equal(card._elements.list.children[0].children[1].tagName, 'img');
	assert.equal(card._elements.list.children[0].children[1].className, 'alert-icon');
	assert.equal(card._elements.list.children[0].children[1].attributes.get('src'), './icons/macd.svg');
	assert.equal(card._elements.list.children[0].children[1].attributes.get('alt'), 'MACD');
	assert.equal(card._elements.list.children[0].children[2].textContent, 'Crossed below Signal');
	assert.equal(card._elements.list.children[1].classList.contains('bullish'), true);
	assert.equal(card._elements.list.children[1].children[1].attributes.get('src'), './icons/macd.svg');
	assert.equal(card._elements.list.children[1].children[2].textContent, 'Crossed above Signal');

	card.addAlert({
		type: 'MACD_CROSS_BULLISH',
		source: 'macd',
		time: Date.UTC(2026, 0, 2, 3, 6, 5),
		message: 'Crossed above Signal'
	});
	assert.equal(card._elements.title.textContent, 'Alerts (3)');
	assert.equal(card._elements.list.children.length, 2);
	assert.equal(card._elements.list.children[1].classList.contains('bearish'), true);

	card.clear();
	card.addAlert({
		type: 'VOLUME_SPIKE',
		source: 'volume',
		severity: 'info',
		time: Date.UTC(2026, 0, 2, 3, 7, 5),
		message: 'High volume spike detected.'
	});
	assert.equal(card._elements.list.children[0].classList.contains('bearish'), false);
	assert.equal(card._elements.list.children[0].children[1].attributes.get('src'), './icons/volume.svg');
	assert.equal(card._elements.list.children[0].children[2].textContent, 'High volume spike detected.');

	card.addAlert({
		type: 'RSI_OVERBOUGHT',
		source: 'rsi',
		direction: 'bearish',
		severity: 'warning',
		time: Date.UTC(2026, 0, 2, 3, 8, 5),
		message: 'Overbought (>70). Potential pullback.'
	});
	assert.equal(card._elements.list.children[0].children[1].attributes.get('src'), './icons/rsi.svg');
	assert.equal(card._elements.list.children[0].children[2].textContent, 'Overbought (>70). Potential pullback.');
	assert.equal(card._elements.title.textContent, 'Alerts (5)');

	card.clear();
	assert.equal(card._elements.list.children.length, 0);
});
