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
	card.addAlert({
		type: 'MACD_CROSS_BULLISH',
		time: Date.UTC(2026, 0, 2, 3, 4, 5),
		message: 'MACD crossed above Signal'
	});
	card.addAlert({
		type: 'MACD_CROSS_BEARISH',
		time: Date.UTC(2026, 0, 2, 3, 5, 5),
		message: 'MACD crossed below Signal'
	});

	assert.equal(card._elements.root.children[0].className, 'card-title');
	assert.equal(card._elements.root.children[0].textContent, 'Alerts');
	assert.equal(card._elements.list.parentNode.className, 'card-body');
	assert.equal(card._elements.list.children.length, 2);
	assert.equal(card._elements.list.children[0].classList.contains('bearish'), true);
	assert.equal(card._elements.list.children[0].classList.contains('alert-pulse'), true);
	assert.equal(card._elements.list.children[1].classList.contains('bullish'), true);

	card.addAlert({
		type: 'MACD_CROSS_BULLISH',
		time: Date.UTC(2026, 0, 2, 3, 6, 5),
		message: 'MACD crossed above Signal'
	});
	assert.equal(card._elements.list.children.length, 2);
	assert.equal(card._elements.list.children[1].classList.contains('bearish'), true);

	card.clear();
	assert.equal(card._elements.list.children.length, 0);
});
