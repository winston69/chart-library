import test from 'node:test';
import assert from 'node:assert/strict';
import { TradesCard } from '../cards/TradesCard.js';

class Element {
	constructor(tagName) {
		this.tagName = tagName;
		this.children = [];
		this.textContent = '';
		this.className = '';
		this.classNames = new Set();
		this.classList = {
			add: name => this.classNames.add(name),
			contains: name => this.classNames.has(name)
		};
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

test('TradesCard prepends trades, colors rows, and caps the table at 50', t => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
	globalThis.document = { createElement: tagName => new Element(tagName) };
	t.after(() => {
		if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
		else delete globalThis.document;
	});

	const card = new TradesCard();
	card.render(new Element('div'));

	card.addTrade({
		time: '12:00:00',
		price: '100.00',
		value: '100',
		isBuyerMaker: false,
		qty: 5,
		aveBuy: 3,
		aveSell: 0,
		aveBuyValue: '300',
		aveSellValue: '0'
	});
	card.addTrade({
		time: '12:00:01',
		price: '101.00',
		value: '101',
		isBuyerMaker: true,
		qty: 2,
		aveBuy: 3,
		aveSell: 4,
		aveBuyValue: '303',
		aveSellValue: '404'
	});

	assert.equal(card._elements.root.children[0].className, 'card-title');
	assert.equal(card._elements.root.children[0].textContent, 'Trades (2)');
	assert.deepEqual(
		card._elements.root.children[1].children[0].children[0].children[0].children
			.map(header => header.textContent),
		['Time', 'Price', 'Value', 'AveBuy', 'AveSell', 'Sig']
	);
	assert.equal(card._elements.tbody.parentNode.parentNode.className, 'card-body');
	assert.equal(card._elements.tbody.children[0].children[0].textContent, '12:00:01');
	assert.equal(card._elements.tbody.children[0].classList.contains('sell'), true);
	assert.equal(card._elements.tbody.children[0].children[3].textContent, '303');
	assert.equal(card._elements.tbody.children[0].children[4].textContent, '404');
	assert.equal(card._elements.tbody.children[0].children[5].textContent, '💧');
	assert.equal(card._elements.tbody.children[0].children[1].classList.contains('align-right'), true);
	assert.equal(card._elements.tbody.children[0].children[2].classList.contains('align-right'), true);
	assert.equal(card._elements.tbody.children[0].children[3].classList.contains('align-right'), true);
	assert.equal(card._elements.tbody.children[0].children[4].classList.contains('align-right'), true);
	assert.equal(card._elements.tbody.children[0].children[5].classList.contains('align-center'), true);
	assert.equal(card._elements.tbody.children[1].classList.contains('buy'), true);
	assert.equal(card._elements.tbody.children[1].children[5].textContent, '🔥');

	card.addTrade({
		time: '12:00:02',
		price: '102.00',
		value: '102',
		isBuyerMaker: false,
		qty: 3,
		aveBuy: 3,
		aveSell: 4,
		aveBuyValue: '306',
		aveSellValue: '408'
	});
	assert.equal(card._elements.tbody.children[0].children[5].textContent, '➖');

	for (let index = 0; index < 51; index++) {
		card.addTrade({
			time: `12:01:${String(index).padStart(2, '0')}`,
			price: String(index),
			value: String(index),
			isBuyerMaker: false,
			qty: 1,
			aveBuy: 1,
			aveSell: 1,
			aveBuyValue: '1',
			aveSellValue: '1'
		});
	}

	assert.equal(card._elements.tbody.children.length, 50);
	assert.equal(card._elements.root.children[0].textContent, 'Trades (50)');
	assert.equal(card._elements.tbody.children[0].children[0].textContent, '12:01:50');
	assert.equal(card._elements.tbody.children.at(-1).children[0].textContent, '12:01:01');

	card.clear();
	assert.equal(card._elements.tbody.children.length, 0);
	assert.equal(card._elements.root.children[0].textContent, 'Trades (0)');
});
