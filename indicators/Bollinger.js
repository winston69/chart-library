// ──────────────────────────────────────────────────────────────
// indicators/Bollinger.js
//
// Bollinger Bands rendering indicator. A class extending
// BaseIndicator.
//
// Four layers:
//   fill   — BandFill between lower and upper, rendered behind
//   lower  — lower boundary line (mean − k·σ)
//   upper  — upper boundary line (mean + k·σ)
//   mean   — moving-average line, primary (drives the y-axis)
//
// Bollinger values are expected on the input rows:
//   row.bbMean    — moving average
//   row.bbUpper   — upper boundary
//   row.bbLower   — lower boundary
//
// The matching computer lives in ./Bollinger.calc.js and is run
// by the worker. This class only renders — it reads the three
// fields above off each row.
//
// Registration order:
//   The lower and upper Line instances are constructed first so
//   the fill can reference them. But the fill is *added to the
//   plane* first so it renders behind the lines. The `layers`
//   array therefore has `fill` at index 0, which is what
//   remove() unwinds in reverse.
//
// Usage:
//   const bb = new Bollinger({ plane, yGroup: 'price-group', height: 0.45 });
//   bb.appendOrUpdate(row, keyFn);
//   bb.setData(rows);
//   bb.remove();
// ──────────────────────────────────────────────────────────────

import { Line } from '../layers/Line.js';
import { BandFill } from '../layers/BandFill.js';
import { BaseIndicator } from './BaseIndicator.js';

const DEFAULT_HEIGHT = 0.55;
const DEFAULT_DECIMALS = 7;

function getPrice(row) {
	if (Number.isFinite(row.lastPrice)) return row.lastPrice;
	return row.close;
}

export function detectBollingerBreakout(prevRow, row) {
	if (!prevRow || !row) return null;
	const previousPrice = getPrice(prevRow);
	const price = getPrice(row);
	if (![previousPrice, price].every(Number.isFinite)) return null;

	if ([prevRow.bbUpper, row.bbUpper].every(Number.isFinite)
		&& previousPrice <= prevRow.bbUpper && price > row.bbUpper) {
		return {
			type: 'BB_UPPER_BREAKOUT',
			time: row.eventTime ?? row.openTime,
			message: 'Price broke above Upper Bollinger Band.',
			direction: 'bullish',
			severity: 'info'
		};
	}
	if ([prevRow.bbLower, row.bbLower].every(Number.isFinite)
		&& previousPrice >= prevRow.bbLower && price < row.bbLower) {
		return {
			type: 'BB_LOWER_BREAKOUT',
			time: row.eventTime ?? row.openTime,
			message: 'Price broke below Lower Bollinger Band.',
			direction: 'bearish',
			severity: 'warning'
		};
	}
	return null;
}

export class Bollinger extends BaseIndicator {
	constructor(options = {}) {
		super({
			name: 'bollinger',
			scaleType: options.scaleType || 'price',
			yGroup: options.yGroup || 'price-group',
			bandPosition: options.bandPosition || 'middle',
			bandHeight: options.bandHeight,
			axisOptions: options.axisOptions,
			plane: options.plane
		});

		const {
			height = DEFAULT_HEIGHT,
			decimals = DEFAULT_DECIMALS,
			xAccessor = d => d.eventTime,
			meanAccessor = d => d.bbMean,
			upperAccessor = d => d.bbUpper,
			lowerAccessor = d => d.bbLower,
			showFill = true,
			showLines = true,
			showMean = true,
			trimTail = false,
			idPrefix = 'bb',
			onRowUpdate = null
		} = options;

		this.onRowUpdate = typeof onRowUpdate === 'function' ? onRowUpdate : null;

		// ─── Boundary lines (constructed first, added later) ───
		const lowerLine = new Line({
			id: `${idPrefix}-lower`,
			name: 'BB Lower',
			label: 'BB −2σ',
			decimals,
			data: [],
			xAccessor,
			yAccessor: lowerAccessor,
			trimTail
		});

		const upperLine = new Line({
			id: `${idPrefix}-upper`,
			name: 'BB Upper',
			label: 'BB +2σ',
			decimals,
			data: [],
			xAccessor,
			yAccessor: upperAccessor,
			trimTail
		});

		// ─── Fill (rendered behind the lines) ───
		if (showFill) {
			this.fill = this.addLayer(
				new BandFill({
					id: `${idPrefix}-fill`,
					name: 'Bollinger Fill',
					plane: this.plane,
					lowerSource: lowerLine,
					upperSource: upperLine
				}),
				{ height }
			);
		} else {
			this.fill = null;
		}

		// ─── Boundary lines ───
		if (showLines) {
			this.lower = this.addLayer(lowerLine, { height });
			this.upper = this.addLayer(upperLine, { height });
		} else {
			this.lower = null;
			this.upper = null;
		}

		// ─── Mean line (primary) ───
		if (showMean) {
			this.mean = this.addLayer(
				new Line({
					id: `${idPrefix}-mean`,
					name: 'BB Mean',
					label: 'BB Mean',
					decimals,
					data: [],
					xAccessor,
					yAccessor: meanAccessor,
					trimTail
				}),
				{ height, primary: true }
			);
		} else {
			this.mean = null;
		}

		this.build();
	}

	appendOrUpdate(row, keyFn) {
		const data = this.primaryLayer && this.primaryLayer.data;
		const prevRow = data && data.length > 0 ? data[data.length - 1] : null;

		super.appendOrUpdate(row, keyFn);

		if (prevRow && this.onRowUpdate) {
			const event = detectBollingerBreakout(prevRow, row);
			if (event) this.onRowUpdate(event);
		}
	}
}

export default Bollinger;