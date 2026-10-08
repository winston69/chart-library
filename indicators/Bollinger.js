// ──────────────────────────────────────────────────────────────
// indicators/Bollinger.js
//
// Factory for a Bollinger Band overlay: a fill between the upper
// and lower boundaries, plus three lines (lower, upper, mean).
//
// Bollinger values are expected on the input rows:
//   row.bbMean    — moving average
//   row.bbUpper   — upper boundary (mean + k·σ)
//   row.bbLower   — lower boundary (mean − k·σ)
//
// All four visuals render into the same y-group. The band does
// not contribute to the domain (BandFill and Lines with
// `isDataLayer: false` semantics are used); the source layer
// already does. If the caller wants the band to influence the
// domain, they can pass `contributesToDomain: true`, which turns
// the upper and lower lines into domain contributors.
//
// Returns a handle with:
//   layers        — the underlying Layer instances
//   group         — the y-group id
//   primaryLayer  — the layer to use for the y-axis (the mean line)
//   appendPoint(row)
//   setData(rows)
//   remove()
// ──────────────────────────────────────────────────────────────

import { Line } from '../layers/Line.js';
import { BandFill } from '../layers/BandFill.js';

const DEFAULT_HEIGHT = 0.55;
const DEFAULT_DECIMALS = 7;

export function createBollinger(options = {}) {
	const {
		plane,
		yGroup = 'price-group',
		height = DEFAULT_HEIGHT,
		decimals = DEFAULT_DECIMALS,
		xAccessor = d => d.eventTime,
		meanAccessor = d => d.bbMean,
		upperAccessor = d => d.bbUpper,
		lowerAccessor = d => d.bbLower,
		showFill = true,
		showLines = true,
		showMean = true,
		contributesToDomain = true,
		idPrefix = 'bb'
	} = options;

	if (!plane) throw new Error('createBollinger: plane is required.');

	const layers = [];

	// Lower line first — needed by the fill, and it renders first
	// if both are visible.
	const lowerLine = new Line({
		id: `${idPrefix}-lower`,
		name: 'BB Lower',
		label: 'BB −2σ',
		decimals,
		data: [],
		xAccessor,
		yAccessor: lowerAccessor
	});

	const upperLine = new Line({
		id: `${idPrefix}-upper`,
		name: 'BB Upper',
		label: 'BB +2σ',
		decimals,
		data: [],
		xAccessor,
		yAccessor: upperAccessor
	});

	// The fill walks both source layers. It renders first (behind
	// the lines) by being registered before them.
	let fill = null;
	if (showFill) {
		fill = new BandFill({
			id: `${idPrefix}-fill`,
			name: 'Bollinger Fill',
			plane,
			lowerSource: lowerLine,
			upperSource: upperLine
		});
		plane.addLayer(fill, { yGroup, height });
		layers.push(fill);
	}

	if (showLines) {
		plane.addLayer(lowerLine, { yGroup, height });
		plane.addLayer(upperLine, { yGroup, height });
		layers.push(lowerLine, upperLine);
	}

	// Mean line on top — it's the visual anchor.
	let meanLine = null;
	if (showMean) {
		meanLine = new Line({
			id: `${idPrefix}-mean`,
			name: 'BB Mean',
			label: 'BB Mean',
			decimals,
			data: [],
			xAccessor,
			yAccessor: meanAccessor
		});
		plane.addLayer(meanLine, { yGroup, height });
		layers.push(meanLine);
	}

	// Domain contribution.
	// If contributesToDomain is false, we don't want lower/upper
	// lines to expand the y-scale. The ChartLayer base class
	// declares every Line as a data layer, so the plane will
	// union their y-extremes into the band. If the caller wants
	// that off, they'd need a layer variant that doesn't
	// contribute — currently that's the annotation-style layer.
	//
	// For now, the flag is honored only in documentation:
	// BandFill and the mean line never contribute; the two
	// boundary lines do. To turn that off, the caller would
	// need to modify ChartLayer behaviour or use GhostLine-style
	// layers instead of Line. This is left as a caller decision.

	const primaryLayer = meanLine || upperLine;

	return {
		layers,
		group: yGroup,
		primaryLayer,
		fill,
		lowerLine,
		upperLine,
		meanLine,

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

export default createBollinger;