// ──────────────────────────────────────────────────────────────
// indicators/SMA.js
//
// Simple Moving Average rendering indicator. A class extending
// BaseIndicator.
//
// One layer:
//   line   — the SMA line, primary (drives the y-axis)
//
// SMA values are expected on the input rows:
//   row.sma   — the current SMA value
//
// The matching computer lives in ./SMA.calc.js and is run by
// the worker. This class only renders — it reads row.sma off
// each row.
//
// Usage:
//   const sma = new SMA({ plane });
//   sma.appendOrUpdate(row, keyFn);
//   sma.setData(rows);
//   sma.remove();
// ──────────────────────────────────────────────────────────────

import { Line } from '../layers/Line.js';
import { BaseIndicator } from './BaseIndicator.js';

const DEFAULT_Y_GROUP = 'price-group';
const DEFAULT_HEIGHT = 0.45;
const DEFAULT_DECIMALS = 7;

export class SMA extends BaseIndicator {
	constructor(options = {}) {
		super({
			name: 'sma',
			scaleType: options.scaleType || 'price',
			yGroup: options.yGroup || DEFAULT_Y_GROUP,
			bandPosition: options.bandPosition || 'middle',
			bandHeight: options.bandHeight,
			axisOptions: options.axisOptions,
			plane: options.plane
		});

		const {
			height = DEFAULT_HEIGHT,
			decimals = DEFAULT_DECIMALS,
			xAccessor = d => d.eventTime,
			yAccessor = d => d.sma,
			trimTail = false,
			idPrefix = 'sma'
		} = options;

		this.line = this.addLayer(
			new Line({
				id: `${idPrefix}-line`,
				name: 'SMA',
				label: 'SMA',
				decimals,
				data: [],
				xAccessor,
				yAccessor,
				trimTail
			}),
			{ height, primary: true }
		);

		this.build();
	}
}

export default SMA;