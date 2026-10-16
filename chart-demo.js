// ──────────────────────────────────────────────────────────────
// chart-demo.js
//
// Demo wiring. Four bands, bottom to top:
//   volume, rsi, price, macd
//
// Band stack (bottom → top):
//   volume  — Volume indicator (BarChart)
//   rsi     — RSI indicator (line + 70/30 levels)
//   price   — candles + Bollinger + SMA + VWMA
//   macd    — MACD indicator (histogram + line + signal)
//
// All indicators are classes extending BaseIndicator. They own
// their layers and expose a uniform dispatch contract:
//   appendOrUpdate(row, keyFn), setData(rows), remove()
//
// The feed worker computes derived fields (macd, rsi, bb*, sma,
// vwma) from raw trades; the main thread only renders.
// ──────────────────────────────────────────────────────────────

// Core
import { CartesianPlane } from './core/CartesianPlane.js';
import { Events } from './core/Events.js';

// Axes
import { XAxis } from './axes/XAxis.js';
import { YAxis } from './axes/YAxis.js';

// Layers
import { Line } from './layers/Line.js';
import { Area } from './layers/Area.js';
import { GhostLine } from './layers/GhostLine.js';
import { CandleStick } from './layers/CandleStick.js';
import { ReferenceLine } from './layers/ReferenceLine.js';

// Indicators
import { MACD } from './indicators/MACD.js';
import { RSI } from './indicators/RSI.js';
import { Bollinger } from './indicators/Bollinger.js';
import { SMA } from './indicators/SMA.js';
import { VWMA } from './indicators/VWMA.js';
import { Volume } from './indicators/Volume.js';

// Interaction
import { ChartSelection } from './interaction/ChartSelection.js';
import { CrosshairLayer } from './interaction/CrosshairLayer.js';
import { InteractionLayer } from './interaction/InteractionLayer.js';

// Cards
import { CardStrip } from './cards/CardStrip.js';
import { Legend } from './cards/Legend.js';
import { OHLCCard } from './cards/OHLCCard.js';
import { InfoCard } from './cards/InfoCard.js';

// UI
import { Button } from './ui/Button.js';
import { ToolBar } from './ui/ToolBar.js';
import { ToolTip } from './ui/ToolTip.js';

// ─── CONSTANTS ───

// ─── DECIMAL PRECISION ───
// Temporary. Will be sourced from the exchange's symbol
// metadata once the live symbol selector lands. Until then,
// every layer that displays or formats numeric values reads
// from here so there's one place to change.
const SYMBOL_DECIMALS = 2;

const BUCKET_MS = 900000;        // 15-minute candles
const WINDOW_MS = 86400000;      // 24-hour visible window
const VISUAL_UPDATE_MS = 1000;   // 1 Hz tick cadence
const PERIOD_MS = 3600000;       // 1-hour rolling window for SMA / VWMA

const BAND_HEIGHTS = {
	macd: 0.20,
	price: 0.45,
	rsi: 0.15,
	volume: 0.15
};

const INDICATORS = [
	'macd',
	'rsi',
	'bollinger',
	{ name: 'sma', source: 'close', periodMs: PERIOD_MS },
	{ name: 'vwma', source: 'exact', periodMs: PERIOD_MS }
];

// ─── BUCKET KEY ───
// A row's identity within a candle. Two rows with the same key
// belong to the same bucket; the second replaces the first in
// place.
function bucketKey(row) {
	return Math.floor((row.openTime || 0) / BUCKET_MS);
}

const xAcc = d => d.openTime;

// ─── PLANE ───

const container = document.body;

const plane = new CartesianPlane({
	id: 'main-plane',
	domainStrategy: 'expanding',
	padding: 0.05,
	windowSize: WINDOW_MS,  // 24h visible
	maxData: 7 * 86400000,	// 7 days retained, regardless of window
	xScaleType: 'time',
	autoAdjustY: true
});

plane.mount(container);

// ─── TOOLTIP ───

const tooltip = new ToolTip({
	id: 'main-tooltip',
	container: plane._elements.htmlOverlay,
	bounds: () => plane.getPlotArea()
});
tooltip.render();

// ─── SELECTION ───

const chartSelection = new ChartSelection({ plane });

// ─── PRICE LAYERS (standalone, not indicators) ───

const priceChart = new CandleStick({
	id: 'price-candles',
	name: 'Price',
	decimals: SYMBOL_DECIMALS,
	data: [],
	xAccessor: xAcc,
	openAccessor: d => d.openPrice,
	highAccessor: d => d.highPrice,
	lowAccessor: d => d.lowPrice,
	closeAccessor: d => d.lastPrice,
	candleWidthFactor: 0.7,
	trimTail: true
});


// ─── INDICATORS ───
// Registered bottom-first so _yGroupOrder stacks them top-down.
// Order: volume, rsi, price, macd.

// 1. Volume — bottom band
const volume = new Volume({
	plane,
	height: BAND_HEIGHTS.volume,
	xAccessor: xAcc,
	trimTail: true
});

plane.addLayer(priceChart, { yGroup: 'price-group', height: BAND_HEIGHTS.price });

// 2. RSI — above volume
const rsi = new RSI({
	plane,
	height: BAND_HEIGHTS.rsi,
	decimals: SYMBOL_DECIMALS,
	xAccessor: xAcc,
	trimTail: true
});

// 3. Price band overlays — Bollinger, SMA, VWMA all live in
// price-group, behind and in front of the candles as configured.
// Registration order matters: overlays that should render behind
// the candles register first.

const bollinger = new Bollinger({
	plane,
	height: BAND_HEIGHTS.price,
	decimals: SYMBOL_DECIMALS,
	xAccessor: xAcc,
	trimTail: true
});

const sma = new SMA({
	plane,
	height: BAND_HEIGHTS.price,
	decimals: SYMBOL_DECIMALS,
	xAccessor: xAcc,
	trimTail: true
});

const vwma = new VWMA({
	plane,
	height: BAND_HEIGHTS.price,
	decimals: SYMBOL_DECIMALS,
	xAccessor: xAcc,
	trimTail: true
});

// 4. MACD — top band
const macd = new MACD({
	plane,
	height: BAND_HEIGHTS.macd,
	decimals: SYMBOL_DECIMALS + 4,
	xAccessor: xAcc,
	trimTail: true
});

// ─── AXES ───

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
	scale: plane.getYScaleForChart(volume.bars),
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
	scale: plane.getYScaleForChart(macd.primaryLayer),
	bandGroupId: 'macd-group',
	showGrid: false,
	showTicks: true,
	showTickLabels: true,
	showLabel: true,
	tickCount: 4
});

const rsiYAxis = new YAxis({
	id: 'rsi-y-axis',
	label: 'RSI',
	orientation: 'right',
	positionIntent: 'outside',
	scale: plane.getYScaleForChart(rsi.primaryLayer),
	bandGroupId: 'rsi-group',
	showGrid: false,
	showTicks: true,
	showTickLabels: true,
	showLabel: true,
	tickCount: 4,
	decimals: 0
});

plane.addLayer(xAxis);
plane.addLayer(volumeYAxis);
plane.addLayer(rsiYAxis);
plane.addLayer(priceYAxis);
plane.addLayer(macdYAxis);

// ─── REFERENCE LINE ───

const referenceLine = new ReferenceLine({
	id: 'ref-line',
	label: 'Price',
	sourceLayer: priceChart,
	valueAccessor: (stats) => stats.lastY,
	showLabel: false,
	showValue: true,
	labelFormat: (v) => v.toFixed(SYMBOL_DECIMALS),
	pulse: true
});

plane.addLayer(referenceLine);

// ─── CROSSHAIR ───

const crosshair = new CrosshairLayer({
	id: 'crosshair',
	xAxis,
	yAxes: {
		'macd-group': macdYAxis,
		'price-group': priceYAxis,
		'rsi-group': rsiYAxis,
		'volume-group': volumeYAxis
	}
});

// ─── CARD STRIP ───

const cardStrip = new CardStrip({
	id: 'main-card-strip',
	plane,
	rowHeight: 64,
	defaultCardWidth: 96
});

// ─── INTERACTION ───

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

// ─── CARDS ───

const legendCard = new Legend({
	id: 'main-legend',
	title: '🎯 Price Update!!',
	width: 140,
	plane,
	selection: chartSelection,
	valueFormat: (v) => v.toFixed(SYMBOL_DECIMALS),
	autoDetect: false,
	items: [
		{ label: 'Price', layer: priceChart, color: '#4ade80', format: v => v.toFixed(SYMBOL_DECIMALS) },
		{ label: 'SMA', layer: sma.line, color: '#f783ac', format: v => v.toFixed(SYMBOL_DECIMALS) },
		{ label: 'VWMA', layer: vwma.line, color: '#ffa94d', format: v => v.toFixed(SYMBOL_DECIMALS) },
		{ label: 'BB Mean', layer: bollinger.mean, color: '#845ef7', format: v => v.toFixed(SYMBOL_DECIMALS) },
		{ label: 'MACD', layer: macd.line, color: '#22d3ee', format: v => v.toFixed(SYMBOL_DECIMALS) },
		{ label: 'Volume', layer: volume.bars, color: '#4dabf7', format: v => v.toFixed(0) }
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
	decimals: SYMBOL_DECIMALS
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

// ─── HANDLE LIST ───
// Every indicator handle, plus the standalone price layer. Used
// by the tick dispatcher and by clearAllCharts. Order doesn't
// matter here — dispatch is per-handle.

const handles = [priceChart, volume, rsi, bollinger, sma, vwma, macd];

// ─── DATA FEEDS ───

const feed = new Worker('./chart-demo-feed.js', { type: 'module' });
const liveWorker = new Worker('./chart-demo-live.js', { type: 'module' });

let feedRunning = false;
let liveRunning = false;

function applySeed(rows) {
	for (const h of handles) h.setData(rows);
	plane.update();
}

function applyTick(row) {
	for (const h of handles) h.appendOrUpdate(row, bucketKey);
	plane.update();
}

// ─── SIMULATED FEED WIRING ───

feed.onmessage = (evt) => {
	const msg = evt.data;
	if (!msg || typeof msg.type !== 'string') return;

	switch (msg.type) {
		case 'seed':
			applySeed(msg.data);
			break;
		case 'tick':
			applyTick(msg.data);
			break;
		case 'state':
			feedRunning = msg.running;
			autoButton.setIcon(msg.running ? 'stop' : 'play');
			autoButton.setTooltip(msg.running ? 'Stop auto-append' : 'Auto-append');
			break;
		case 'error':
			console.error('[feed]', msg.message);
			break;
	}
};

feed.onerror = (err) => {
	console.error('[DataFeed] worker error:', err.message || err);
};

feed.postMessage({
	type: 'config',
	bucketMs: BUCKET_MS,
	tickMs: VISUAL_UPDATE_MS,
	windowMs: WINDOW_MS,
	eventTimeField: 'eventTime',
	indicators: INDICATORS
});
feed.postMessage({ type: 'seed' });

// ─── LIVE FEED WIRING ───

liveWorker.onmessage = (evt) => {
	const msg = evt.data;
	if (!msg || typeof msg.type !== 'string') return;

	switch (msg.type) {
		case 'seed':
			applySeed(msg.data);
			break;
		case 'tick':
			applyTick(msg.data);
			break;
		case 'state':
			liveRunning = msg.running;
			liveButton.setSelected(msg.running);
			liveButton.setIcon(msg.running ? 'stop' : 'play');
			liveButton.setTooltip(
				msg.running
					? (msg.connected ? 'Disconnect from live feed' : 'Connecting…')
					: 'Connect to live feed'
			);
			break;
		case 'error':
			console.error('[live]', msg.message);
			break;
	}
};

liveWorker.onerror = (err) => {
	console.error('[LiveFeed] worker error:', err.message || err);
};

liveWorker.postMessage({
	type: 'config',
	symbol: 'BTCPHP',
	stream: 'trade',
	bucketMs: BUCKET_MS,
	tickMs: VISUAL_UPDATE_MS,
	windowMs: WINDOW_MS,
	eventTimeField: 'eventTime',
	indicators: INDICATORS
});

// ─── TOOLBAR ───

const toolbar = new ToolBar({
	id: 'main-toolbar',
	plane,
	position: 'top',
	positionIntent: 'outside'
});

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
	icon: 'pan',
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
	icon: 'zoom',
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
	icon: 'reset',
	size: 'sm',
	variant: 'ghost',
	tooltip: 'Reset zoom (or double-click the chart)',
	onClick: () => plane.resetZoom('both')
});

// ─── Layer toggles ───
const timeAxisButton = makeLayerToggle({
	id: 'toggle-time-axis',
	icon: 'axisTime',
	tooltip: 'Show/Hide Time Axis',
	layer: xAxis
});

const priceAxisButton = makeLayerToggle({
	id: 'toggle-price-axis',
	icon: 'axisValue',
	tooltip: 'Show/Hide Price Y-Axis',
	layer: priceYAxis
});

const volumeAxisButton = makeLayerToggle({
	id: 'toggle-volume-axis',
	icon: 'axisValue',
	tooltip: 'Show/Hide Volume Y-Axis',
	layer: volumeYAxis
});

const macdAxisButton = makeLayerToggle({
	id: 'toggle-macd-axis',
	icon: 'axisValue',
	tooltip: 'Show/Hide MACD Y-Axis',
	layer: macdYAxis
});

const crosshairButton = makeLayerToggle({
	id: 'toggle-crosshair',
	icon: 'crosshair',
	tooltip: 'Show/Hide Crosshair',
	variant: 'ghost',
	layer: crosshair
});

// ─── Card toggles ───
const legendButton = cardToggleButton({
	id: 'toggle-legend',
	icon: 'legend',
	tooltip: 'Show/Hide Legend',
	card: legendCard
});

const ohlcButton = cardToggleButton({
	id: 'toggle-ohlc',
	icon: 'ohlc',
	tooltip: 'Show/Hide OHLC',
	card: ohlcCard
});

const infoButton = cardToggleButton({
	id: 'toggle-info',
	icon: 'info',
	tooltip: 'Show/Hide Metrics',
	card: infoCard
});

// ─── Fullscreen ───
const fullscreenButton = new Button({
	id: 'toggle-fullscreen',
	icon: 'fullscreen',
	size: 'sm',
	variant: 'ghost',
	tooltip: 'Enter Fullscreen',
	onClick: () => plane.toggleFullscreen()
});

plane.events.on(Events.FULLSCREEN_CHANGED, (data) => {
	fullscreenButton.setIcon(data.fullscreen ? 'fullscreenExit' : 'fullscreen');
	fullscreenButton.setTooltip(data.fullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen');
});

// ─── Demo controls ───
const addPointButton = new Button({
	id: 'ctrl-add-point',
	icon: 'add',
	size: 'sm',
	variant: 'primary',
	tooltip: '+ Add Point',
	onClick: () => appendPoint()
});

const addBatchButton = new Button({
	id: 'ctrl-add-batch',
	icon: 'batch',
	size: 'sm',
	variant: 'primary',
	tooltip: '+ Add 5',
	onClick: () => {
		for (let i = 0; i < 5; i++) feed.postMessage({ type: 'tick' });
	}
});

const resetChartsButton = new Button({
	id: 'ctrl-reset',
	icon: 'reset',
	size: 'sm',
	variant: 'secondary',
	tooltip: 'Reset charts',
	onClick: () => resetCharts()
});

const autoButton = new Button({
	id: 'ctrl-auto',
	icon: 'play',
	size: 'sm',
	variant: 'danger',
	tooltip: 'Stop auto-append',
	onClick: () => toggleAuto()
});

const liveButton = new Button({
	id: 'toggle-live',
	icon: 'play',
	size: 'sm',
	variant: 'ghost',
	tooltip: 'Connect to live feed',
	selected: false,
	onClick: () => {
		clearAllCharts();

		if (liveRunning) {
			liveWorker.postMessage({ type: 'stop' });
			feed.postMessage({ type: 'reset' });
		} else {
			feed.postMessage({ type: 'stop' });
			feedRunning = false;
			autoButton.setIcon('play');
			autoButton.setTooltip('Auto-append');
			liveWorker.postMessage({ type: 'start' });
		}
	}
});

const MAX_DATA_OPTIONS = [
	{ ms: 1 * 86400000, label: '1d' },
	{ ms: 7 * 86400000, label: '7d' },
	{ ms: 30 * 86400000, label: '30d' },
	{ ms: 90 * 86400000, label: '90d' }
];
let maxDataIndex = 1;    // 7d default
plane.maxData = MAX_DATA_OPTIONS[maxDataIndex].ms;

const historyButton = new Button({
	id: 'ctrl-history',
	icon: 'strategy',
	label: MAX_DATA_OPTIONS[maxDataIndex].label,
	size: 'sm',
	variant: 'success',
	tooltip: `History: ${MAX_DATA_OPTIONS[maxDataIndex].label}`,
	onClick: () => {
		maxDataIndex = (maxDataIndex + 1) % MAX_DATA_OPTIONS.length;
		const opt = MAX_DATA_OPTIONS[maxDataIndex];
		plane.maxData = opt.ms;
		historyButton.setLabel(opt.label);
		historyButton.setTooltip(`History: ${opt.label}`);
		plane.update();
	}
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

toolbar.addItem(liveButton);

plane.addLayer(toolbar);
plane.addLayer(cardStrip);

plane.update();

// ─── DATA MUTATION ───

function appendPoint() {
	feed.postMessage({ type: 'tick' });
}

function clearAllCharts() {
	for (const h of handles) h.setData([]);
	plane.update();
}

function resetCharts() {
	clearAllCharts();
	feed.postMessage({ type: 'reset' });
	feedRunning = false;
	autoButton.setIcon('play');
	autoButton.setTooltip('Auto-append');
}

// ─── DEMO CONTROLS ───

function toggleAuto() {
	if (feedRunning) {
		feed.postMessage({ type: 'stop' });
		feedRunning = false;
		autoButton.setIcon('play');
		autoButton.setTooltip('Auto-append');
	} else {
		feed.postMessage({ type: 'start' });
		feedRunning = true;
		autoButton.setIcon('stop');
		autoButton.setTooltip('Stop auto-append');
	}
}

// ─── KEYBOARD SHORTCUTS ───

document.addEventListener('keydown', (e) => {
	if (e.key === ' ' || e.key === 'Space') {
		e.preventDefault();
		toggleAuto();
	}
	if (e.key === 'a' || e.key === 'A') appendPoint();
	if (e.key === 'r' || e.key === 'R') resetCharts();
});