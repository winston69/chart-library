// ──────────────────────────────────────────────────────────────
// indicators/MACD.js
//
// MACD rendering indicator. A class extending BaseIndicator.
//
// Three layers:
//   histogram  — BarChart, signed, colored by direction, behind
//   line       — the MACD line, primary (drives the y-axis)
//   signal     — the signal line
//
// MACD values are expected on the input rows:
//   row.macd            — MACD line value
//   row.macdSignal      — signal line value
//   row.macdHistogram   — histogram value (macd − signal)
//
// The matching computer lives in ./MACD.calc.js and is run by
// the worker. This class only renders — it reads the fields above
// off each row.
//
// Usage:
//   const macd = new MACD({ plane, yGroup: 'macd-group', height: 0.2 });
//   macd.appendOrUpdate(row, keyFn);
//   macd.setData(rows);
//   macd.remove();
// ──────────────────────────────────────────────────────────────

import { Line } from '../layers/Line.js';
import { BarChart } from '../layers/BarChart.js';
import { BaseIndicator } from './BaseIndicator.js';

const DEFAULT_HEIGHT = 0.25;
const DEFAULT_DECIMALS = 7;

export class MACD extends BaseIndicator {
	constructor(options = {}) {
		super({
			name: 'macd',
			yGroup: options.yGroup || 'macd-group',
			plane: options.plane
		});

		const {
			height = DEFAULT_HEIGHT,
			decimals = DEFAULT_DECIMALS,
			xAccessor = d => d.eventTime,
			macdAccessor = d => d.macd,
			signalAccessor = d => d.macdSignal,
			histogramAccessor = d => d.macdHistogram,
			showHistogram = true,
			showMacdLine = true,
			showSignalLine = true,
			trimTail = false,
			idPrefix = 'macd'
		} = options;

		// ─── Histogram (behind) ───
		if (showHistogram) {
			this.histogram = this.addLayer(
				new BarChart({
					id: `${idPrefix}-histogram`,
					name: 'Histogram',
					decimals,
					data: [],
					xAccessor,
					yAccessor: histogramAccessor,
					directionMode: 'sign',
					baseline: 'zero',
					barWidthFactor: 0.7,
					trimTail
				}),
				{ height }
			);
		} else {
			this.histogram = null;
		}

		// ─── MACD line (primary) ───
		if (showMacdLine) {
			this.line = this.addLayer(
				new Line({
					id: `${idPrefix}-line`,
					name: 'MACD',
					decimals,
					data: [],
					xAccessor,
					yAccessor: macdAccessor,
					trimTail
				}),
				{ height, primary: true }
			);
		} else {
			this.line = null;
		}

		// ─── Signal line ───
		if (showSignalLine) {
			this.signal = this.addLayer(
				new Line({
					id: `${idPrefix}-signal`,
					name: 'Signal',
					decimals,
					data: [],
					xAccessor,
					yAccessor: signalAccessor,
					trimTail
				}),
				{ height }
			);
		} else {
			this.signal = null;
		}

		this.build();
	}
}

export default MACD;