// ──────────────────────────────────────────────────────────────
// CSS.js
// ──────────────────────────────────────────────────────────────

/**
 * Reads a CSS variable from the document root and returns it as a
 * string. Returns null if the variable is not defined.
 */
function get(property) {
	const value = getComputedStyle(document.documentElement)
		.getPropertyValue(property)
		.trim();
	return value || null;
}

/**
 * Reads a numeric CSS variable from the document root.
 *
 * Throws if the variable is missing or its value is not parseable
 * as a number, so a broken stylesheet fails at the point of read
 * rather than producing a silently wrong value downstream. The
 * error message names the variable so the fix is obvious.
 *
 * Accepts values with a trailing unit (e.g. "2px" → 2, "1.5s" → 1.5)
 * so designers can write the variable the way CSS expects.
 */
function getNumber(property) {
	const raw = getComputedStyle(document.documentElement)
		.getPropertyValue(property)
		.trim();

	if (raw === '') {
		throw new Error(
			`CSS variable "${property}" is not defined. ` +
			`Check that its stylesheet is loaded.`
		);
	}

	const n = parseFloat(raw);
	if (!isFinite(n)) {
		throw new Error(
			`CSS variable "${property}" is not a number: "${raw}".`
		);
	}

	return n;
}

export const CSS = {
	// ─── Layers ───
	line: {
		group: 'line-group',
		path: 'line-path'
	},

	area: {
		group: 'area-group',
		area: 'area-fill'
	},

	points: {
		group: 'points-group',
		point: 'points-point'
	},

	ghostLine: {
		group: 'ghost-group',
		path: 'ghost-path'
	},

	bandFill: {
		group: 'band-fill-group',
		path: 'band-fill-path'
	},

	barChart: {
		group: 'bar-group',
		barUp: 'bar-up-bars',
		barDown: 'bar-down-bars'
	},

	candleStick: {
		outer: 'candle-group-outer',
		group: 'candle-group',
		wicks: 'candle-wicks',
		upBody: 'candle-up-bodies',
		downBody: 'candle-down-bodies',
		path: 'candle-path',
		pathGhost: 'candle-path-ghost'
	},

	referenceLine: {
		container: 'ref-container',
		line: 'ref-line',
		label: 'ref-label',
		arrow: 'ref-arrow',
		pulse: 'ref-pulse',
		ring: 'ref-ring',
		pulseCss: 'ref-pulse-css',
		ringCss: 'ref-ring-css'
	},

	crosshair: {
		container: 'crosshair-container',
		bandGroup: 'crosshair-band',
		vertical: 'crosshair-v',
		horizontal: 'crosshair-h',
		labelX: 'crosshair-label-x',
		labelY: 'crosshair-label-y',
		snapDot: 'crosshair-snap-dot'
	},

	interaction: {
		container: 'int-container',
		zoomRect: 'int-zoom-rect'
	},

	axis: {
		axis: 'axis-axis',
		axisLine: 'axis-axis-line',
		tickLine: 'axis-tick-line',
		minorTick: 'axis-minor-tick',
		microTick: 'axis-micro-tick',
		tickLabel: 'axis-tick-label',
		tickLabelInside: 'axis-tick-label inside',
		tickLabelOutside: 'axis-tick-label outside',
		axisLabel: 'axis-axis-label',
		gridLine: 'axis-grid-line'
	},

	cartesianPlane: {
		container: 'cp-container',
		svg: 'cp-svg',
		layerGroup: 'cp-layers',
		rootGroup: 'cp-root',
		plotArea: 'cp-plot-area',
		plotBg: 'cp-plot-bg',
		grid: 'cp-grid',
		bands: 'cp-bands',
		band: 'cp-band',
		bandBackground: 'cp-band-bg',
		annotations: 'cp-annotations',
		overlay: 'cp-overlay',
		marginTop: 'cp-margin cp-margin-top',
		marginBottom: 'cp-margin cp-margin-bottom',
		marginLeft: 'cp-margin cp-margin-left',
		marginRight: 'cp-margin cp-margin-right',
		handles: 'cp-handles',
		handle: 'cp-band-handle',
		handlesNone: 'cp-handles--none',
		handlesOnHover: 'cp-handles--onHover',
		handlesAlways: 'cp-handles--always',
		htmlOverlay: 'cp-html-overlay'
	},

	// ─── UI ───
	button: {
		btn: 'btn',
		sm: 'btn-sm',
		md: 'btn-md',
		lg: 'btn-lg',
		primary: 'btn-primary',
		secondary: 'btn-secondary',
		success: 'btn-success',
		danger: 'btn-danger',
		warning: 'btn-warning',
		ghost: 'btn-ghost',
		selected: 'btn-selected',
		disabled: 'btn-disabled',
		iconOnly: 'btn-icon-only',
		iconEmoji: 'btn-icon',
		label: 'btn-label',
		shortcut: 'btn-shortcut'
	},

	toolbar: {
		container: 'tb-container',
		group: 'tb-group'
	},

	tooltip: {
		container: 'tooltip-container',
		content: 'tooltip-content'
	},

	// ─── Cards ───
	cardStrip: {
		container: 'cs-container',
		card: 'cs-card'
	},

	legend: {
		card: 'leg-card',
		title: 'leg-title',
		items: 'leg-items',
		item: 'leg-item',
		marker: 'leg-marker',
		label: 'leg-label',
		value: 'leg-value'
	},

	ohlcCard: {
		card: 'ohlc-card',
		title: 'ohlc-title',
		rows: 'ohlc-rows',
		row: 'ohlc-row',
		label: 'ohlc-label',
		value: 'ohlc-value'
	},

	infoCard: {
		card: 'info-card',
		title: 'info-title',
		grid: 'info-grid',
		cell: 'info-cell',
		icon: 'info-icon',
		value: 'info-value'
	},

	// ─── Selection ───
	selection: {
		chartNormal: 'sel-chart-normal',
		chartSelected: 'sel-chart-selected',
		chartUnselected: 'sel-chart-unselected'
	},

	// ─── Readers ───
	get,
	getNumber
};

export default CSS;