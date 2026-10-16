// ──────────────────────────────────────────────────────────────
// indicators/RSI.js
//
// RSI rendering indicator. A class extending BaseIndicator.
//
// Three layers:
//   line   — the RSI line, primary (drives the y-axis)
//   upper  — the overbought reference level (default 70)
//   lower  — the oversold reference level (default 30)
//
// RSI values are expected on the input rows:
//   row.rsi   — the RSI value (0..100)
//
// The matching computer lives in ./RSI.calc.js and is run by
// the worker. This class only renders — it reads row.rsi off
// each row.
//
// The upper and lower lines use constant y accessors, so
// appendPoint/updateLastPoint pass every row through unchanged.
// They exist to give the RSI band a fixed visual frame; they do
// not carry independent data.
//
// Usage:
//   const rsi = new RSI({ plane, yGroup: 'rsi-group', height: 0.15 });
//   rsi.appendOrUpdate(row, keyFn);
//   rsi.setData(rows);
//   rsi.remove();
// ──────────────────────────────────────────────────────────────

import { Line } from '../layers/Line.js';
import { BaseIndicator } from './BaseIndicator.js';

const DEFAULT_HEIGHT = 0.20;
const DEFAULT_DECIMALS = 2;

export class RSI extends BaseIndicator {
	constructor(options = {}) {
		super({
			name: 'rsi',
			yGroup: options.yGroup || 'rsi-group',
			plane: options.plane
		});

		const {
			height = DEFAULT_HEIGHT,
			decimals = DEFAULT_DECIMALS,
			xAccessor = d => d.eventTime,
			rsiAccessor = d => d.rsi,
			upperLevel = 70,
			lowerLevel = 30,
			showLevels = true,
			trimTail = false,
			idPrefix = 'rsi'
		} = options;

		// ─── RSI line (primary) ───
		this.line = this.addLayer(
			new Line({
				id: `${idPrefix}-line`,
				name: 'RSI',
				decimals,
				data: [],
				xAccessor,
				yAccessor: rsiAccessor,
				trimTail
			}),
			{ height, primary: true }
		);

		// ─── Overbought reference (upper) ───
		if (showLevels) {
			this.upper = this.addLayer(
				new Line({
					id: `${idPrefix}-upper`,
					name: 'RSI 70',
					label: 'RSI 70',
					decimals,
					data: [],
					xAccessor,
					yAccessor: () => upperLevel,
					trimTail
				}),
				{ height }
			);

			// ─── Oversold reference (lower) ───
			this.lower = this.addLayer(
				new Line({
					id: `${idPrefix}-lower`,
					name: 'RSI 30',
					label: 'RSI 30',
					decimals,
					data: [],
					xAccessor,
					yAccessor: () => lowerLevel,
					trimTail
				}),
				{ height }
			);
		} else {
			this.upper = null;
			this.lower = null;
		}

		this.build();
	}
}

export default RSI;