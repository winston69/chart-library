// ──────────────────────────────────────────────────────────────
// indicators/RSI.js
//
// Factory for a Relative Strength Index pane: the RSI line, plus
// two reference levels at 70 (overbought) and 30 (oversold).
//
// RSI values are expected on the input rows:
//   row.rsi   — the RSI value (0..100)
//
// The 70 and 30 levels are drawn as flat Line layers with a
// constant yAccessor. They live in the same y-group as the RSI
// line, which means the y-axis will span [30, 70] if the RSI
// itself stays within those bounds. In practice RSI will
// occasionally exceed them, which is normal — the band's y-scale
// unions all three series' y-extents.
//
// Returns a handle with:
//   layers        — the underlying Layer instances
//   group         — the y-group id
//   primaryLayer  — the RSI line (used for the y-axis)
//   appendPoint(row)
//   setData(rows)
//   remove()
// ──────────────────────────────────────────────────────────────

import { Line } from '../layers/Line.js';

const DEFAULT_HEIGHT = 0.20;
const DEFAULT_DECIMALS = 2;

export function createRSI(options = {}) {
	const {
		plane,
		yGroup = 'rsi-group',
		height = DEFAULT_HEIGHT,
		decimals = DEFAULT_DECIMALS,
		xAccessor = d => d.eventTime,
		rsiAccessor = d => d.rsi,
		upperLevel = 70,
		lowerLevel = 30,
		showLevels = true,
		idPrefix = 'rsi'
	} = options;

	if (!plane) throw new Error('createRSI: plane is required.');

	const layers = [];

	// The RSI line.
	const rsiLine = new Line({
		id: `${idPrefix}-line`,
		name: 'RSI',
		decimals,
		data: [],
		xAccessor,
		yAccessor: rsiAccessor
	});
	plane.addLayer(rsiLine, { yGroup, height });
	layers.push(rsiLine);

	// Upper level (overbought).
	let upperLine = null;
	if (showLevels) {
		upperLine = new Line({
			id: `${idPrefix}-upper`,
			name: 'RSI 70',
			label: 'RSI 70',
			decimals,
			data: [],
			xAccessor,
			yAccessor: () => upperLevel
		});
		plane.addLayer(upperLine, { yGroup, height });
		layers.push(upperLine);

		// Lower level (oversold).
		const lowerLine = new Line({
			id: `${idPrefix}-lower`,
			name: 'RSI 30',
			label: 'RSI 30',
			decimals,
			data: [],
			xAccessor,
			yAccessor: () => lowerLevel
		});
		plane.addLayer(lowerLine, { yGroup, height });
		layers.push(lowerLine);
	}

	return {
		layers,
		group: yGroup,
		primaryLayer: rsiLine,
		rsiLine,
		upperLine,

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
			for (let i = layers.length - 1; i >= 0; i--) {
				plane.removeLayer(layers[i]);
			}
		}
	};
}

export default createRSI;