// ──────────────────────────────────────────────────────────────
// chart-demo.js
//
// Demo wiring for a three-band chart:
//   - Top:    MACD (histogram + line + signal)
//   - Middle: Price (Bollinger + WAP + candles + ghosts)
//   - Bottom: Volume (signed bars)
//   - Shared x-axis with sliding window
//   - Reference line, crosshair, tooltip
//   - Card strip: Legend, OHLC, Info
//   - Toolbar: mode, layer toggles, card toggles, controls
//   - Live data from a Web Worker (demo-feed.js)
// ──────────────────────────────────────────────────────────────

import { Events } from './core/Events.js';
import { Button } from './ui/Button.js';

import { CartesianPlane } from './core/CartesianPlane.js';
import { XAxis } from './axes/XAxis.js';
import { YAxis } from './axes/YAxis.js';

import { Line } from './layers/Line.js';
import { Area } from './layers/Area.js';
// import { Points } from './layers/Points.js';
import { GhostLine } from './layers/GhostLine.js';
import { BandFill } from './layers/BandFill.js';

import { CandleStick } from './layers/CandleStick.js';
import { BarChart } from './layers/BarChart.js';

import { ReferenceLine } from './layers/ReferenceLine.js';

import { ChartSelection } from './interaction/ChartSelection.js';
import { CrosshairLayer } from './interaction/CrosshairLayer.js';
import { InteractionLayer } from './interaction/InteractionLayer.js';

import { CardStrip } from './cards/CardStrip.js';
import { Legend } from './cards/Legend.js';
import { OHLCCard } from './cards/OHLCCard.js';
import { InfoCard } from './cards/InfoCard.js';

import { ToolBar } from './ui/ToolBar.js';
import { ToolTip } from './ui/ToolTip.js';

// ──────────────────────────────────────────────────────────────
// CONSTANTS
// ──────────────────────────────────────────────────────────────

const WINDOW_MS = 900000;       // 15-minute sliding window
const VISUAL_UPDATE_MS = 1000;  // tick cadence

// Band heights (top → bottom). Sum to 1.
const BAND_HEIGHTS = {
	macd: 0.20,
	price: 0.70,
	volume: 0.10
};

// ──────────────────────────────────────────────────────────────
// PLANE
// ──────────────────────────────────────────────────────────────

const container = document.body;

const plane = new CartesianPlane({
	id: 'main-plane',
	domainStrategy: 'sliding',
	windowSize: WINDOW_MS,
	xScaleType: 'time',
	autoAdjustY: true
});

plane.mount(container);

// ──────────────────────────────────────────────────────────────
// TOOLTIP
// ──────────────────────────────────────────────────────────────

const tooltip = new ToolTip({
	id: 'main-tooltip',
	container: plane._elements.htmlOverlay,
	bounds: () => plane.getPlotArea()
});
tooltip.render();

// ──────────────────────────────────────────────────────────────
// SELECTION
// ──────────────────────────────────────────────────────────────

const chartSelection = new ChartSelection({ plane });

// ──────────────────────────────────────────────────────────────
// LAYERS — PRICE BAND
// ──────────────────────────────────────────────────────────────

const priceChart = new CandleStick({
	id: 'price-candles',
	name: 'Price',
	decimals: 7,
	data: [],
	xAccessor: d => d.eventTime,
	openAccessor: d => d.openPrice,
	highAccessor: d => d.highPrice,
	lowAccessor: d => d.lowPrice,
	closeAccessor: d => d.lastPrice,
	candleWidthFactor: 0.7
});

const wapChart = new Line({
	id: 'wap-chart',
	name: 'WAP',
	decimals: 7,
	data: [],
	xAccessor: d => d.eventTime,
	yAccessor: d => d.weightedAvgPrice
});

const wapArea = new Area({
	id: 'wap-area',
	name: 'WAP Area',
	plane,
	sourceLayer: wapChart,
	baseline: 'dataMin'
});

const priceGhost = new GhostLine({
	id: 'price-ghost',
	plane,
	sourceLayer: priceChart
});

const wapGhost = new GhostLine({
	id: 'wap-ghost',
	plane,
	sourceLayer: wapChart
});

// Bollinger on price
const bbFill = new BandFill({
	id: 'bb-fill',
	name: 'Bollinger Fill',
	plane,
	lowerSource: null,
	upperSource: null
});

const bbLower = new Line({
	id: 'bb-lower',
	name: 'BB Lower',
	label: 'BB −2σ',
	decimals: 7,
	data: [],
	xAccessor: d => d.eventTime,
	yAccessor: d => d.bbLower
});

const bbUpper = new Line({
	id: 'bb-upper',
	name: 'BB Upper',
	label: 'BB +2σ',
	decimals: 7,
	data: [],
	xAccessor: d => d.eventTime,
	yAccessor: d => d.bbUpper
});

const bbMean = new Line({
	id: 'bb-mean',
	name: 'BB Mean',
	label: 'BB Mean',
	decimals: 7,
	data: [],
	xAccessor: d => d.eventTime,
	yAccessor: d => d.bbMean
});

bbFill.lowerSource = bbLower;
bbFill.upperSource = bbUpper;

// ──────────────────────────────────────────────────────────────
// LAYERS — VOLUME BAND
// ──────────────────────────────────────────────────────────────

const volumeChart = new BarChart({
	id: 'volume-chart',
	name: 'Volume',
	decimals: 0,
	data: [],
	xAccessor: d => d.eventTime,
	yAccessor: d => d.volume,
	openAccessor: d => d.openPrice,
	closeAccessor: d => d.lastPrice,
	baseline: 'zero',
	barWidthFactor: 0.7
});

// ──────────────────────────────────────────────────────────────
// LAYERS — MACD BAND
// ──────────────────────────────────────────────────────────────

const macdHistogramChart = new BarChart({
	id: 'macd-histogram',
	name: 'Histogram',
	decimals: 7,
	data: [],
	xAccessor: d => d.eventTime,
	yAccessor: d => d.macdHistogram,
	directionMode: 'sign',
	baseline: 'zero',
	barWidthFactor: 0.9 //0.7
});

const macdChart = new Line({
	id: 'macd-line',
	name: 'MACD',
	decimals: 7,
	data: [],
	xAccessor: d => d.eventTime,
	yAccessor: d => d.macd
});

const macdSignalChart = new Line({
	id: 'macd-signal',
	name: 'Signal',
	decimals: 7,
	data: [],
	xAccessor: d => d.eventTime,
	yAccessor: d => d.macdSignal
});

// ──────────────────────────────────────────────────────────────
// LAYER REGISTRATION
// ──────────────────────────────────────────────────────────────
// Band order top → bottom: MACD, price, volume.
// Within each band, registration order determines paint order:
// earlier layers sit behind later ones.

// Volume band.
plane.addLayer(volumeChart, { yGroup: 'volume-group', height: BAND_HEIGHTS.volume });

// Price band — ghosts, then Bollinger, then WAP area, then data.
plane.addLayer(priceGhost, { yGroup: 'price-group', height: BAND_HEIGHTS.price });
plane.addLayer(wapGhost, { yGroup: 'price-group', height: BAND_HEIGHTS.price });

plane.addLayer(bbFill, { yGroup: 'price-group', height: BAND_HEIGHTS.price });
plane.addLayer(bbLower, { yGroup: 'price-group', height: BAND_HEIGHTS.price });
plane.addLayer(bbUpper, { yGroup: 'price-group', height: BAND_HEIGHTS.price });
plane.addLayer(bbMean, { yGroup: 'price-group', height: BAND_HEIGHTS.price });

plane.addLayer(wapArea, { yGroup: 'price-group', height: BAND_HEIGHTS.price });
plane.addLayer(wapChart, { yGroup: 'price-group', height: BAND_HEIGHTS.price });
plane.addLayer(priceChart, { yGroup: 'price-group', height: BAND_HEIGHTS.price });

// MACD band — histogram behind the two lines.
plane.addLayer(macdHistogramChart, { yGroup: 'macd-group', height: BAND_HEIGHTS.macd });
plane.addLayer(macdChart, { yGroup: 'macd-group', height: BAND_HEIGHTS.macd });
plane.addLayer(macdSignalChart, { yGroup: 'macd-group', height: BAND_HEIGHTS.macd });

// ──────────────────────────────────────────────────────────────
// AXES
// ──────────────────────────────────────────────────────────────

const timeFormat = new Intl.DateTimeFormat("en-US", {
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
	hour12: false,
	timeZone: 'Asia/Manila'
});

const xAxis = new XAxis({
	id: 'x-axis',
	label: 'Time',
	orientation: 'bottom',
	positionIntent: 'outside',
	scale: plane.xScale,
	decimals: 0,
	showGrid: true,
	tickCount: 15,
	tickFormat: (v) => timeFormat.format(v)
});

const priceYAxis = new YAxis({
	id: 'price-y-axis',
	label: 'Price / WAP',
	orientation: 'right',
	positionIntent: 'outside',
	scale: plane.getYScaleForChart(priceChart),
	bandGroupId: 'price-group',
	showGrid: false,
	showTicks: true,
	showTickLabels: true,
	showLabel: true,
	tickCount: 10,
	tickStepMode: 'decimal',
	showMinorTicks: true,
	showMicroTicks: true
});

const volumeYAxis = new YAxis({
	id: 'volume-y-axis',
	label: 'Volume',
	orientation: 'right',
	positionIntent: 'outside',
	scale: plane.getYScaleForChart(volumeChart),
	bandGroupId: 'volume-group',
	showGrid: false,
	showTicks: true,
	showTickLabels: true,
	showLabel: true,
	tickCount: 4,
	decimals: 0
});

const macdYAxis = new YAxis({
	id: 'macd-y-axis',
	label: 'MACD',
	orientation: 'right',
	positionIntent: 'outside',
	scale: plane.getYScaleForChart(macdChart),
	bandGroupId: 'macd-group',
	showGrid: false,
	showTicks: true,
	showTickLabels: true,
	showLabel: true,
	tickCount: 4
});

plane.addLayer(xAxis);
plane.addLayer(priceYAxis);
plane.addLayer(volumeYAxis);
plane.addLayer(macdYAxis);

// ──────────────────────────────────────────────────────────────
// REFERENCE LINE
// ──────────────────────────────────────────────────────────────

const referenceLine = new ReferenceLine({
	id: 'ref-line',
	label: 'Price',
	sourceLayer: priceChart,
	valueAccessor: (stats) => stats.lastY,
	showLabel: false,
	showValue: true,
	labelFormat: (v) => v.toFixed(4),
	pulse: true
});

plane.addLayer(referenceLine);

// ──────────────────────────────────────────────────────────────
// CROSSHAIR
// ──────────────────────────────────────────────────────────────

const crosshair = new CrosshairLayer({
	id: 'crosshair',
	xAxis,
	yAxes: {
		'macd-group': macdYAxis,
		'price-group': priceYAxis,
		'volume-group': volumeYAxis
	}
});

// ──────────────────────────────────────────────────────────────
// CARD STRIP
// ──────────────────────────────────────────────────────────────

const cardStrip = new CardStrip({
	id: 'main-card-strip',
	plane,
	rowHeight: 64,
	defaultCardWidth: 96
});

// ──────────────────────────────────────────────────────────────
// INTERACTION
// ──────────────────────────────────────────────────────────────

const interaction = new InteractionLayer({
	id: 'interaction',
	plane,
	enablePan: true,
	enableZoom: true,
	enableWheelZoom: true,

	defaultPanAxis: 'x',
	defaultZoomAxis: 'both',
	panShiftAxis: 'y',
	panAltAxis: 'both',
	zoomShiftAxis: 'x',
	zoomAltAxis: 'y',

	wheelDefaultAxis: 'x',
	wheelShiftAxis: 'y',
	wheelAltAxis: 'both',

	showZoomRect: true,
	axisDragFactor: 2.0
});

plane.addLayer(interaction);

// ──────────────────────────────────────────────────────────────
// CARDS
// ──────────────────────────────────────────────────────────────

const legendCard = new Legend({
	id: 'main-legend',
	title: '🎯 Price Update!!',
	width: 120,
	plane,
	selection: chartSelection,
	valueFormat: (v) => v.toFixed(7),
	autoDetect: false,
	items: [
		{ label: 'Price', layer: priceChart, color: '#4ade80', format: v => v.toFixed(7) },
		{ label: 'WAP', layer: wapChart, color: '#ffd43b', format: v => v.toFixed(7) },
		{ label: 'Volume', layer: volumeChart, color: '#4dabf7', format: v => v.toFixed(0) },
		{ label: 'MACD', layer: macdChart, color: '#22d3ee', format: v => v.toFixed(7) }
	]
});
cardStrip.addCard(legendCard);

const ohlcCard = new OHLCCard({
	id: 'main-ohlc',
	plane,
	layer: priceChart,
	crosshair,
	title: 'Price',
	width: 96,
	decimals: 7
});
cardStrip.addCard(ohlcCard);

const infoCard = new InfoCard({
	id: 'main-info',
	plane,
	layer: priceChart,
	title: '📊 Metrics',
	width: 120
});
cardStrip.addCard(infoCard);

crosshair.onMove = (payload) => {
	if (!payload) {
		tooltip.hide();
	} else {
		const { pixel, labels } = payload;
		const lines = [];
		if (labels.x) lines.push(`x: ${labels.x}`);
		if (labels.y !== null) lines.push(`y: ${labels.y}`);
		tooltip.show(pixel.x, pixel.y, lines.join('\n'));
	}
	ohlcCard.onCrosshairMove(payload);
};

// ──────────────────────────────────────────────────────────────
// DATA FEED
// ──────────────────────────────────────────────────────────────

const feed = new Worker('./chart-demo-feed.js', { type: 'module' });

let feedRunning = false;

feed.onmessage = (evt) => {
	const msg = evt.data;
	if (!msg || typeof msg.type !== 'string') return;

	switch (msg.type) {
		case 'seed': {
			priceChart.setData(msg.data);
			wapChart.setData(msg.data);
			bbMean.setData(msg.data);
			bbUpper.setData(msg.data);
			bbLower.setData(msg.data);
			volumeChart.setData(msg.data);
			macdChart.setData(msg.data);
			macdSignalChart.setData(msg.data);
			macdHistogramChart.setData(msg.data);
			plane.update();
			break;
		}
		case 'tick': {
			priceChart.appendPoint(msg.data);
			wapChart.appendPoint(msg.data);
			bbMean.appendPoint(msg.data);
			bbUpper.appendPoint(msg.data);
			bbLower.appendPoint(msg.data);
			volumeChart.appendPoint(msg.data);
			macdChart.appendPoint(msg.data);
			macdSignalChart.appendPoint(msg.data);
			macdHistogramChart.appendPoint(msg.data);
			plane.update();
			break;
		}
		case 'state': {
			feedRunning = msg.running;
			autoButton.setIcon(msg.running ? '⏹️' : '▶️');
			autoButton.setTooltip(msg.running ? 'Stop auto-append' : 'Auto-append');
			break;
		}
		default:
			break;
	}
};

feed.onerror = (err) => {
	console.error('[DataFeed] worker error:', err.message || err);
};

feed.postMessage({
	type: 'config',
	intervalMs: VISUAL_UPDATE_MS,
	windowMs: WINDOW_MS,
	eventTimeField: 'eventTime'
});
feed.postMessage({ type: 'seed' });
feedRunning = false;

// ──────────────────────────────────────────────────────────────
// TOOLBAR
// ──────────────────────────────────────────────────────────────

const toolbar = new ToolBar({
	id: 'main-toolbar',
	plane,
	position: 'top',
	positionIntent: 'outside'
});

// ─── Toggle factories ───
function layerToggleButton({ id, icon, tooltip, variant = 'secondary', layer }) {
	return new Button({
		id,
		icon,
		size: 'sm',
		variant,
		tooltip,
		selected: !!plane.getLayer(layer.id),
		onClick: () => {
			if (plane.getLayer(layer.id)) plane.removeLayer(layer);
			else plane.addLayer(layer, layer._addOptions);
			// Re-evaluate the visual state from the plane.
			const btn = this;
		}
	});
}

function cardToggleButton({ id, icon, tooltip, card }) {
	const btn = new Button({
		id,
		icon,
		size: 'sm',
		variant: 'secondary',
		tooltip,
		selected: true,
		onClick: () => {
			const present = cardStrip.getCards().indexOf(card) !== -1;
			if (present) cardStrip.removeCard(card);
			else cardStrip.addCard(card);
			btn.setSelected(!present);
		}
	});
	return btn;
}

// Note: layerToggleButton as written above needs the button instance
// to update its own selection state. Rewriting it to create and return
// the button, then attach the click via the returned instance, is
// cleaner. The version below is the one to use.
function makeLayerToggle({ id, icon, tooltip, variant = 'secondary', layer }) {
	const btn = new Button({
		id,
		icon,
		size: 'sm',
		variant,
		tooltip,
		selected: !!plane.getLayer(layer.id),
		onClick: () => {
			if (plane.getLayer(layer.id)) plane.removeLayer(layer);
			else plane.addLayer(layer, layer._addOptions);
			btn.setSelected(!!plane.getLayer(layer.id));
		}
	});
	return btn;
}

// ─── Interaction mode ───
const panButton = new Button({
	id: 'mode-pan',
	icon: '🖐️',
	size: 'sm',
	variant: 'ghost',
	tooltip: 'Pan mode (drag to move)',
	selected: true,
	onClick: () => {
		plane.setInteractionMode('pan');
		panButton.setSelected(true);
		zoomButton.setSelected(false);
	}
});

const zoomButton = new Button({
	id: 'mode-zoom',
	icon: '🔍',
	size: 'sm',
	variant: 'ghost',
	tooltip: 'Zoom mode (drag a rectangle)',
	selected: false,
	onClick: () => {
		plane.setInteractionMode('zoom');
		panButton.setSelected(false);
		zoomButton.setSelected(true);
	}
});

const resetButton = new Button({
	id: 'mode-reset',
	icon: '🔄',
	size: 'sm',
	variant: 'ghost',
	tooltip: 'Reset zoom (or double-click the chart)',
	onClick: () => plane.resetZoom('both')
});

// ─── Layer toggles ───
const timeAxisButton = makeLayerToggle({
	id: 'toggle-time-axis',
	icon: '⏱️',
	tooltip: 'Show/Hide Time Axis',
	variant: 'primary',
	layer: xAxis
});

const priceAxisButton = makeLayerToggle({
	id: 'toggle-price-axis',
	icon: '📊',
	tooltip: 'Show/Hide Price Y-Axis',
	layer: priceYAxis
});

const volumeAxisButton = makeLayerToggle({
	id: 'toggle-volume-axis',
	icon: '📊',
	tooltip: 'Show/Hide Volume Y-Axis',
	layer: volumeYAxis
});

const macdAxisButton = makeLayerToggle({
	id: 'toggle-macd-axis',
	icon: '📊',
	tooltip: 'Show/Hide MACD Y-Axis',
	layer: macdYAxis
});

const crosshairButton = makeLayerToggle({
	id: 'toggle-crosshair',
	icon: '✛',
	tooltip: 'Show/Hide Crosshair',
	variant: 'ghost',
	layer: crosshair
});

// ─── Card toggles ───
const legendButton = cardToggleButton({
	id: 'toggle-legend',
	icon: '🎯',
	tooltip: 'Show/Hide Legend',
	card: legendCard
});

const ohlcButton = cardToggleButton({
	id: 'toggle-ohlc',
	icon: '💹',
	tooltip: 'Show/Hide OHLC',
	card: ohlcCard
});

const infoButton = cardToggleButton({
	id: 'toggle-info',
	icon: '📋',
	tooltip: 'Show/Hide Metrics',
	card: infoCard
});

// ─── Fullscreen ───
const fullscreenButton = new Button({
	id: 'toggle-fullscreen',
	icon: '⛶',
	size: 'sm',
	variant: 'ghost',
	tooltip: 'Enter Fullscreen',
	onClick: () => plane.toggleFullscreen()
});

plane.events.on(Events.FULLSCREEN_CHANGED, (data) => {
	fullscreenButton.setIcon(data.fullscreen ? '⛗' : '⛶');
	fullscreenButton.setTooltip(data.fullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen');
});

// ─── Demo controls ───
const addPointButton = new Button({
	id: 'ctrl-add-point',
	icon: '➕',
	size: 'sm',
	variant: 'primary',
	tooltip: '+ Add Point',
	onClick: () => appendPoint()
});

const addBatchButton = new Button({
	id: 'ctrl-add-batch',
	icon: '📈',
	size: 'sm',
	variant: 'primary',
	tooltip: '+ Add 5',
	onClick: () => {
		for (let i = 0; i < 5; i++) feed.postMessage({ type: 'tick' });
	}
});

const resetChartsButton = new Button({
	id: 'ctrl-reset',
	icon: '↺',
	size: 'sm',
	variant: 'secondary',
	tooltip: 'Reset charts',
	onClick: () => resetCharts()
});

const autoButton = new Button({
	id: 'ctrl-auto',
	icon: '▶️',
	size: 'sm',
	variant: 'danger',
	tooltip: 'Stop auto-append',
	onClick: () => toggleAuto()
});

const strategyButton = new Button({
	id: 'ctrl-strategy',
	icon: '📐',
	size: 'sm',
	variant: 'success',
	tooltip: 'Cycle domain strategy',
	onClick: () => cycleStrategy()
});

// ─── Toolbar registration ───
toolbar.addItem(crosshairButton);
toolbar.addItem(panButton);
toolbar.addItem(zoomButton);
toolbar.addItem(resetButton);
toolbar.addItem(timeAxisButton);
toolbar.addItem(priceAxisButton);
toolbar.addItem(volumeAxisButton);
toolbar.addItem(macdAxisButton);
toolbar.addItem(legendButton);
toolbar.addItem(ohlcButton);
toolbar.addItem(infoButton);
toolbar.addItem(fullscreenButton);

toolbar.addItem(addPointButton);
toolbar.addItem(addBatchButton);
toolbar.addItem(resetChartsButton);
toolbar.addItem(autoButton);
toolbar.addItem(strategyButton);

plane.addLayer(toolbar);
plane.addLayer(cardStrip);

plane.update();

// ──────────────────────────────────────────────────────────────
// DATA MUTATION
// ──────────────────────────────────────────────────────────────

function appendPoint() {
	feed.postMessage({ type: 'tick' });
}

function resetCharts() {
	feed.postMessage({ type: 'reset' });
	feedRunning = false;
	autoButton.setIcon('▶️');
	autoButton.setTooltip('Auto-append');
}

// ──────────────────────────────────────────────────────────────
// DEMO CONTROLS
// ──────────────────────────────────────────────────────────────

let strategyIndex = 0;
const strategies = ['sliding', 'expanding', 'static'];

function toggleAuto() {
	if (feedRunning) {
		feed.postMessage({ type: 'stop' });
		feedRunning = false;
		autoButton.setIcon('▶️');
		autoButton.setTooltip('Auto-append');
	} else {
		feed.postMessage({ type: 'start' });
		feedRunning = true;
		autoButton.setIcon('⏹️');
		autoButton.setTooltip('Stop auto-append');
	}
}

function cycleStrategy() {
	strategyIndex = (strategyIndex + 1) % strategies.length;
	const s = strategies[strategyIndex];
	plane.domainStrategy = s;
	strategyButton.setTooltip(`Strategy: ${s}`);
	plane.update();
}

// ──────────────────────────────────────────────────────────────
// KEYBOARD SHORTCUTS
// ──────────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
	if (e.key === ' ' || e.key === 'Space') {
		e.preventDefault();
		toggleAuto();
	}
	if (e.key === 'a' || e.key === 'A') appendPoint();
	if (e.key === 'r' || e.key === 'R') resetCharts();
	if (e.key === 's' || e.key === 'S') cycleStrategy();
});