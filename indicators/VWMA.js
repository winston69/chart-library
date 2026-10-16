// ──────────────────────────────────────────────────────────────
// indicators/VWMA.js
//
// Volume-Weighted Moving Average rendering indicator. A class
// extending BaseIndicator.
//
// One layer:
//   line   — the VWMA line, primary (drives the y-axis)
//
// VWMA values are expected on the input rows:
//   row.vwma   — the current VWMA value
//
// The matching computer lives in ./VWMA.calc.js and is run by
// the worker. This class only renders — it reads row.vwma off
// each row.
//
// Usage:
//   const vwma = new VWMA({ plane });
//   vwma.appendOrUpdate(row, keyFn);
//   vwma.setData(rows);
//   vwma.remove();
// ──────────────────────────────────────────────────────────────

import { Line } from '../layers/Line.js';
import { BaseIndicator } from './BaseIndicator.js';

const DEFAULT_Y_GROUP = 'price-group';
const DEFAULT_HEIGHT = 0.45;
const DEFAULT_DECIMALS = 7;

export class VWMA extends BaseIndicator {
	constructor(options = {}) {
		super({
			name: 'vwma',
			yGroup: options.yGroup || DEFAULT_Y_GROUP,
			plane: options.plane
		});

		const {
			height = DEFAULT_HEIGHT,
			decimals = DEFAULT_DECIMALS,
			xAccessor = d => d.eventTime,
			yAccessor = d => d.vwma,
			trimTail = false,
			idPrefix = 'vwma'
		} = options;

		this.line = this.addLayer(
			new Line({
				id: `${idPrefix}-line`,
				name: 'VWMA',
				label: 'VWMA',
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

export default VWMA;