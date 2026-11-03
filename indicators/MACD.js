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

export function detectMACDCross(prevRow, row) {
	if (!prevRow || !row) return null;
	const previousMacd = prevRow.macd;
	const previousSignal = prevRow.macdSignal;
	const macd = row.macd;
	const signal = row.macdSignal;
	if (![previousMacd, previousSignal, macd, signal].every(Number.isFinite)) return null;

	if (previousMacd <= previousSignal && macd > signal) {
		return {
			type: 'MACD_CROSS_BULLISH',
			time: row.openTime,
			message: 'MACD crossed above Signal'
		};
	}
	if (previousMacd >= previousSignal && macd < signal) {
		return {
			type: 'MACD_CROSS_BEARISH',
			time: row.openTime,
			message: 'MACD crossed below Signal'
		};
	}
	return null;
}

export class MACD extends BaseIndicator {
	constructor(options = {}) {
		super({
			name: 'macd',
			scaleType: options.scaleType || 'oscillator',
			yGroup: options.yGroup || 'macd-group',
			bandPosition: options.bandPosition || 'top',
			bandHeight: options.bandHeight !== undefined ? options.bandHeight : 0.20,
			axisOptions: {
				label: 'MACD',
				...(options.axisOptions || {})
			},
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
			idPrefix = 'macd',
			onRowUpdate = null
		} = options;

		this.onRowUpdate = typeof onRowUpdate === 'function' ? onRowUpdate : null;

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

	appendOrUpdate(row, keyFn) {
		const data = this.primaryLayer && this.primaryLayer.data;
		const prevRow = data && data.length > 0 ? data[data.length - 1] : null;

		console.log('MACD tick:', row.macd, row.macdSignal);
		if (prevRow) {
			console.log('MACD previous tick:', prevRow.macd, prevRow.macdSignal);
		}

		super.appendOrUpdate(row, keyFn);

		if (prevRow && this.onRowUpdate) {
			const event = detectMACDCross(prevRow, row);
			if (event) {
				console.log('MACD crossover values:', prevRow.macd, prevRow.macdSignal, row.macd, row.macdSignal);
				this.onRowUpdate(event);
			}
		}
	}
}

export default MACD;