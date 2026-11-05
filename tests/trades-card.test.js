import test from 'node:test';
import assert from 'node:assert/strict';
import { TradesCard } from '../cards/TradesCard.js';
import { RatioBar } from '../ui/RatioBar.js';

class Element {
	constructor(tagName) {
		this.tagName = tagName;
		this.children = [];
		this.textContent = '';
		this.className = '';
		this.innerHTML = '';
		this.attributes = new Map();
		this.classNames = new Set();
		this.style = {};
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

	setAttribute(name, value) {
		this.attributes.set(name, String(value));
	}

	getAttribute(name) {
		return this.attributes.get(name) || null;
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
		aveSellValue: '0',
		buyCount: 1,
		sellCount: 0,
		totalCount: 1242,
		sig: ['🔥']
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
		aveSellValue: '404',
		buyCount: 1,
		sellCount: 1,
		totalCount: 1243,
		sig: ['💧']
	});

	assert.equal(card._elements.root.children[0].className, 'card-title trades-title');
	assert.equal(card._elements.totalCount.textContent, '1,243');
	const windowStats = card._elements.root.children[0].children[2];
	assert.equal(windowStats.children[0].textContent, '15m:');
	assert.match(card._elements.titleRatio.innerHTML, /class="ratio-bar"/);
	assert.deepEqual(
		card._elements.root.children[1].children[0].children[0].children[0].children
			.map(header => header.textContent),
		['Time', 'Side', 'Price', 'Value', 'B/S Ratio', 'Sig']
	);
	assert.equal(card._elements.tbody.parentNode.parentNode.className, 'card-body');
	const latestRow = card._elements.tbody.children[0];
	assert.equal(latestRow.children[0].textContent, '12:00:01');
	assert.equal(latestRow.classList.contains('sell'), true);
	assert.equal(latestRow.children[1].textContent, 'SELL');
	assert.equal(latestRow.children[1].classList.contains('side'), true);
	assert.match(latestRow.children[4].innerHTML, /width="42\.857142857142854"/);
	assert.match(latestRow.children[4].innerHTML, /width="57\.142857142857146"/);
	assert.deepEqual(latestRow.children[5].children.map(signal => signal.textContent), ['💧']);
	assert.equal(latestRow.children[5].children[0].getAttribute('title'), 'Low volume');
	assert.equal(latestRow.children[2].classList.contains('align-right'), true);
	assert.equal(latestRow.children[3].classList.contains('align-right'), true);
	assert.equal(latestRow.children[5].classList.contains('align-center'), true);
	assert.equal(card._elements.tbody.children[1].classList.contains('buy'), true);
	assert.equal(card._elements.tbody.children[1].children[1].textContent, 'BUY');
	assert.deepEqual(card._elements.tbody.children[1].children[5].children
		.map(signal => signal.textContent), ['🔥']);

	card.addTrade({
		time: '12:00:02',
		price: '102.00',
		value: '102',
		isBuyerMaker: false,
		qty: 3,
		aveBuy: 3,
		aveSell: 4,
		aveBuyValue: '306',
		aveSellValue: '408',
		buyCount: 2,
		sellCount: 1,
		totalCount: 1244,
		sig: ['🔥', '🐋']
	});
	const compositeSignals = card._elements.tbody.children[0].children[5].children;
	assert.deepEqual(compositeSignals.map(signal => signal.textContent), ['🔥', '🐋']);
	assert.deepEqual(compositeSignals.map(signal => signal.getAttribute('title')),
		['High volume', 'Whale trade']);

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
			aveSellValue: '1',
			buyCount: 3,
			sellCount: 2,
			totalCount: 1245 + index,
			sig: ['➖']
		});
	}

	assert.equal(card._elements.tbody.children.length, 50);
	assert.equal(card._elements.totalCount.textContent, '1,295');
	assert.equal(card._elements.tbody.children[0].children[0].textContent, '12:01:50');
	assert.equal(card._elements.tbody.children.at(-1).children[0].textContent, '12:01:01');
	assert.equal(card._elements.tbody.children[0].children[5].children[0].getAttribute('title'),
		'Normal volume');

	card.clear();
	assert.equal(card._elements.tbody.children.length, 0);
	assert.equal(card._elements.totalCount.textContent, '0');
	assert.match(card._elements.titleRatio.innerHTML, /Buy 0, sell 0/);
});

test('RatioBar renders proportional segments and omits labels that cannot fit', () => {
	const markup = RatioBar({
		leftValue: 75,
		rightValue: 25,
		leftColor: '#00aa00',
		rightColor: '#cc0000'
	});

	assert.match(markup, /<rect class="ratio-bar-left" x="0" y="0" width="75"/);
	assert.match(markup, /<rect class="ratio-bar-right" x="75" y="0" width="25"/);
	assert.match(markup, /fill="#00aa00"/);
	assert.match(markup, /fill="#cc0000"/);
	assert.match(markup, /<text x="37\.5" y="11">75<\/text>/);
	assert.match(markup, /<text x="87\.5" y="11">25<\/text>/);

	const narrowMarkup = RatioBar({ leftValue: 99, rightValue: 1 });
	assert.match(narrowMarkup, /<text x="49\.5" y="11">99<\/text>/);
	assert.doesNotMatch(narrowMarkup, />1<\/text>/);
});
