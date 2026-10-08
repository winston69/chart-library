// ──────────────────────────────────────────────────────────────
// indicators/MACD.js
//
// Factory for a MACD indicator pane: histogram + MACD line +
// signal line, all in one y-group.
//
// MACD values are expected to be present on the input rows:
//   row.macd            — MACD line value
//   row.macdSignal      — signal line value
//   row.macdHistogram   — histogram value (macd − signal)
//
// Returns a handle with:
//   layers        — the underlying Layer instances
//   group         — the y-group id
//   primaryLayer  — the layer to use for the y-axis (the MACD line)
//   appendPoint(row)
//   setData(rows)
//   remove()
// ──────────────────────────────────────────────────────────────

import { Line } from '../layers/Line.js';
import { BarChart } from '../layers/BarChart.js';

const DEFAULT_HEIGHT = 0.25;
const DEFAULT_DECIMALS = 7;

export function createMACD(options = {}) {
	const {
		plane,
		yGroup = 'macd-group',
		height = DEFAULT_HEIGHT,
		decimals = DEFAULT_DECIMALS,
		xAccessor = d => d.eventTime,
		macdAccessor = d => d.macd,
		signalAccessor = d => d.macdSignal,
		histogramAccessor = d => d.macdHistogram,
		showHistogram = true,
		showMacdLine = true,
		showSignalLine = true,
		idPrefix = 'macd'
	} = options;

	if (!plane) throw new Error('createMACD: plane is required.');

	const layers = [];

	// Histogram first — sits behind the two lines.
	let histogram = null;
	if (showHistogram) {
		histogram = new BarChart({
			id: `${idPrefix}-histogram`,
			name: 'Histogram',
			decimals,
			data: [],
			xAccessor,
			yAccessor: histogramAccessor,
			directionMode: 'sign',
			baseline: 'zero',
			barWidthFactor: 0.7
		});
		plane.addLayer(histogram, { yGroup, height });
		layers.push(histogram);
	}

	// MACD line.
	let macdLine = null;
	if (showMacdLine) {
		macdLine = new Line({
			id: `${idPrefix}-line`,
			name: 'MACD',
			decimals,
			data: [],
			xAccessor,
			yAccessor: macdAccessor
		});
		plane.addLayer(macdLine, { yGroup, height });
		layers.push(macdLine);
	}

	// Signal line.
	let signalLine = null;
	if (showSignalLine) {
		signalLine = new Line({
			id: `${idPrefix}-signal`,
			name: 'Signal',
			decimals,
			data: [],
			xAccessor,
			yAccessor: signalAccessor
		});
		plane.addLayer(signalLine, { yGroup, height });
		layers.push(signalLine);
	}

	// Primary layer for the y-axis. Preference: MACD line, then
	// signal line, then histogram. The first two give the axis a
	// signed range around zero, which matches the pane's visual.
	const primaryLayer = macdLine || signalLine || histogram;

	return {
		layers,
		group: yGroup,
		primaryLayer,
		histogram,
		macdLine,
		signalLine,

		appendPoint(row) {
			for (let i = 0; i < layers.length; i++) {
				const layer = layers[i];
				if (typeof layer.appendPoint === 'function') {
					layer.appendPoint(row);
				}
			}
		},

		setData(rows) {
			for (let i = 0; i < layers.length; i++) {
				const layer = layers[i];
				if (typeof layer.setData === 'function') {
					layer.setData(rows);
				}
			}
		},

		remove() {
			// Remove in reverse so z-order unwinds cleanly.
			for (let i = layers.length - 1; i >= 0; i--) {
				plane.removeLayer(layers[i]);
			}
		}
	};
}

export default createMACD;