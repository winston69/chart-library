// ──────────────────────────────────────────────────────────────
// chart-demo.js
//
// Demo wiring. Bands are resolved from indicator declarations;
// only price and volume are present until standalone indicators are toggled on.
//
// Band stack (bottom → top):
//   volume  — Volume indicator (BarChart)
//   price   — candles + optional Bollinger + SMA + VWMA
//   optional oscillator bands are inserted above the price band
//
// All indicators are classes extending BaseIndicator. They own
// their layers and expose a uniform dispatch contract:
//   appendOrUpdate(row, keyFn), setData(rows), remove()
//
// Feed workers compute derived fields; the main thread only
// renders. Live sources use either raw trades or exchange klines.
//
// Source / feed model:
//   - `currentSource` ('demo' | 'live' | 'live-kline') is set by
//     the source dropdown. It selects which worker is active.
//   - `feedRunning` mirrors the worker's reported state. It is
//     updated from the worker's `state` messages, not assumed.
//   - The feed button starts / pauses the active worker.
//   - Switching source stops the current feed.
//   - The reset-data button stops the current feed, clears the
//     chart, and reseeds. It is an alternative to a browser
//     refresh for the chart's data.
//   - The demo worker is created on page load and seeds the
//     chart. Its timer does not start until the feed button is
//     pressed.
//   - Both live workers are created lazily on first use.
// ──────────────────────────────────────────────────────────────

// Core
import { CartesianPlane } from './core/CartesianPlane.js';
import { Events } from './core/Events.js';

// Axes
import { XAxis } from './axes/XAxis.js';
import { YAxis } from './axes/YAxis.js';

// Layers
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
import { Dropdown } from './ui/Dropdown.js';
import { Checklist } from './ui/Checklist.js';
import { ToolBar } from './ui/ToolBar.js';
import { ToolTip } from './ui/ToolTip.js';

// ─── CONSTANTS ───

// Temporary. Will be sourced from exchange metadata once the
// live symbol selector lands.
const SYMBOL_DECIMALS = 2;

const VISUAL_UPDATE_MS = 1000;   // 1 Hz tick cadence

// ─── CONTROL OPTIONS ───

const TARGET_CANDLES = 96;

const TIMEFRAMES = [
	{ value: 60000, label: '1m', windowMs: TARGET_CANDLES * 60000 },
	{ value: 300000, label: '5m', windowMs: TARGET_CANDLES * 300000 },
	{ value: 900000, label: '15m', windowMs: TARGET_CANDLES * 900000 },
	{ value: 3600000, label: '1h', windowMs: TARGET_CANDLES * 3600000 },
	{ value: 14400000, label: '4h', windowMs: TARGET_CANDLES * 14400000 },
	{ value: 86400000, label: '1d', windowMs: TARGET_CANDLES * 86400000 }
];

const MAX_DATA_OPTIONS = [
	{ value: 1 * 86400000, label: '1d' },
	{ value: 7 * 86400000, label: '7d' },
	{ value: 30 * 86400000, label: '30d' },
	{ value: 90 * 86400000, label: '90d' }
];

const SYMBOL_OPTIONS = [
	{ value: 'BTCPHP', label: 'BTCPHP' },
	{ value: 'USDTPHP', label: 'USDTPHP' },
	{ value: 'ETHPHP', label: 'ETHPHP' }
];

const SOURCE_OPTIONS = [
	{ value: 'demo', label: 'Demo' },
	{ value: 'live', label: 'Live' },
	{ value: 'live-kline', label: 'Live (Klines)' }
];

// ─── MUTABLE CONTROL STATE ───

let currentTimeframe = TIMEFRAMES[2];      // 15m default
let currentMaxData = 7 * 86400000;         // matches plane.maxData
let currentSymbol = 'BTCPHP';              // default live symbol
let currentSource = 'demo';                // 'demo' | 'live' | 'live-kline'
let feedRunning = false;                   // mirrors the active worker's state

function currentBucketMs() { return currentTimeframe.value; }
function currentWindowMs() { return currentTimeframe.windowMs; }
function currentPeriodMs() { return 4 * currentTimeframe.value; }  // 4 buckets

function buildIndicators() {
	const periodMs = currentPeriodMs();
	return [
		'macd',
		'rsi',
		'bollinger',
		{ name: 'sma', source: 'close', periodMs },
		{ name: 'vwma', source: 'typical', periodMs }
	];
}

// ─── BUCKET KEY ───

function bucketKey(row) {
	return Math.floor((row.openTime || 0) / currentBucketMs());
}

const xAcc = d => d.openTime;

// ─── PLANE ───

const container = document.body;

const plane = new CartesianPlane({
	id: 'main-plane',
	domainStrategy: 'expanding',
	padding: 0.05,
	windowSize: currentWindowMs(),
	maxData: currentMaxData,
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

// ─── PRICE LAYER ───

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

// ─── BASE BANDS ───

const volume = new Volume({
	plane,
	xAccessor: xAcc,
	trimTail: true
});

plane.addLayer(priceChart, {
	yGroup: 'price-group',
	height: 1,
	scaleType: 'price',
	bandPosition: 'middle',
	flexibleHeight: true
});

// ─── AXES ───

const timeFormat = new Intl.DateTimeFormat("en-US", {
	hour: '2-digit',
	minute: '2-digit',
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
	label: 'Price',
	orientation: 'right',
	positionIntent: 'outside',
	scale: plane.getYScaleForChart(priceChart),
	bandGroupId: 'price-group',
	showGrid: false,
	showTicks: true,
	showTickLabels: true,
	showLabel: true,
	tickStepMode: 'decimal',
	showMinorTicks: true,
	showMicroTicks: true
});

plane.setYAxisForGroup(priceChart._yGroupId, priceYAxis);

plane.addLayer(xAxis);
plane.addLayer(priceYAxis);

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
	yAxes: new Proxy(Object.create(null), {
		get: (_, groupId) => plane.getYAxisForGroup(groupId)
	})
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

const indicatorInstances = Object.create(null);
let latestRows = priceChart.data;

const indicatorFactories = {
	bollinger: () => new Bollinger({
		plane, decimals: SYMBOL_DECIMALS, xAccessor: xAcc, trimTail: true
	}),
	macd: () => new MACD({
		plane, decimals: SYMBOL_DECIMALS + 4, xAccessor: xAcc, trimTail: true
	}),
	rsi: () => new RSI({
		plane, decimals: SYMBOL_DECIMALS, xAccessor: xAcc, trimTail: true
	}),
	sma: () => new SMA({
		plane, decimals: SYMBOL_DECIMALS, xAccessor: xAcc, trimTail: true
	}),
	vwma: () => new VWMA({
		plane, decimals: SYMBOL_DECIMALS, xAccessor: xAcc, trimTail: true
	})
};

function activeHandles() {
	return [priceChart, volume, ...Object.values(indicatorInstances)];
}

function refreshLegend() {
	legendCard.items = [
		{ label: 'Price', layer: priceChart, color: '#4ade80', format: v => v.toFixed(SYMBOL_DECIMALS) },
		{ label: 'Volume', layer: volume.bars, color: '#4dabf7', format: v => v.toFixed(0) }
	];
	const entries = {
		bollinger: { label: 'BB Mean', layer: 'mean', color: '#845ef7' },
		macd: { label: 'MACD', layer: 'line', color: '#22d3ee' },
		rsi: { label: 'RSI', layer: 'line', color: '#ffd43b' },
		sma: { label: 'SMA', layer: 'line', color: '#f783ac' },
		vwma: { label: 'VWMA', layer: 'line', color: '#ffa94d' }
	};
	for (const [name, entry] of Object.entries(entries)) {
		const indicator = indicatorInstances[name];
		if (indicator && indicator[entry.layer]) {
			legendCard.items.push({
				label: entry.label,
				layer: indicator[entry.layer],
				color: entry.color,
				format: v => v.toFixed(SYMBOL_DECIMALS)
			});
		}
	}
	legendCard._itemsDirty = true;
	legendCard.update();
}

function setIndicatorEnabled(name, enabled) {
	const current = indicatorInstances[name];
	if (enabled && !current) {
		const factory = indicatorFactories[name];
		if (!factory) throw new Error(`Unknown indicator "${name}".`);
		const indicator = factory();
		indicatorInstances[name] = indicator;
		indicator.setData(latestRows);
	} else if (!enabled && current) {
		current.remove();
		delete indicatorInstances[name];
	}
	refreshLegend();
	plane.update();
}

const legendCard = new Legend({
	id: 'main-legend',
	title: '🎯 Price Update',
	width: 140,
	plane,
	selection: chartSelection,
	valueFormat: (v) => v.toFixed(SYMBOL_DECIMALS),
	autoDetect: false,
	items: [
		{ label: 'Price', layer: priceChart, color: '#4ade80', format: v => v.toFixed(SYMBOL_DECIMALS) },
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
	width: 140
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

// ─── DATA APPLICATION ───

function applySeed(rows) {
	priceChart.setData(rows);
	latestRows = priceChart.data;
	for (const h of activeHandles()) {
		if (h !== priceChart) h.setData(latestRows);
	}
	plane.update();
}

function applyTick(row) {
	for (const h of activeHandles()) h.appendOrUpdate(row, bucketKey);
	latestRows = priceChart.data;
	plane.update();
}

// ─── WORKERS ───
// The demo worker is persistent (created on page load, seeds the
// chart, timer idle until the feed button is pressed).
// The live worker is lazy (created on first start).

const demoWorker = new Worker('./chart-demo-feed.js', { type: 'module' });
let liveWorker = null;
let liveKlineWorker = null;

function liveWorkerConfig(source) {
	const config = {
		type: 'config',
		symbol: currentSymbol,
		bucketMs: currentBucketMs(),
		tickMs: VISUAL_UPDATE_MS,
		windowMs: currentWindowMs(),
		maxData: plane.maxData,
		eventTimeField: 'eventTime',
		indicators: buildIndicators()
	};
	if (source === 'live-kline') {
		config.interval = currentTimeframe.label;
	} else {
		config.stream = 'trade';
	}
	return config;
}

function ensureLiveWorker() {
	if (liveWorker) return liveWorker;

	liveWorker = new Worker('./chart-demo-live.js', { type: 'module' });
	liveWorker.onmessage = (evt) => handleLiveMessage(evt, 'live');
	liveWorker.onerror = (err) => {
		console.error('[live feed worker]', err.message || err);
	};

	liveWorker.postMessage(liveWorkerConfig('live'));

	return liveWorker;
}

function ensureLiveKlineWorker() {
	if (liveKlineWorker) return liveKlineWorker;

	liveKlineWorker = new Worker('./chart-demo-live-kline.js', { type: 'module' });
	liveKlineWorker.onmessage = (evt) => handleLiveMessage(evt, 'live-kline');
	liveKlineWorker.onerror = (err) => {
		console.error('[live Kline worker]', err.message || err);
	};
	liveKlineWorker.postMessage(liveWorkerConfig('live-kline'));

	return liveKlineWorker;
}

function ensureLiveWorkerForSource(source) {
	return source === 'live-kline'
		? ensureLiveKlineWorker()
		: ensureLiveWorker();
}

// ─── WORKER MESSAGE HANDLERS ───

function handleDemoMessage(evt) {
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
			if (msg.running !== feedRunning) {
				feedRunning = msg.running;
				updateUI();
			}
			break;
		case 'error':
			console.error('[demo feed]', msg.message);
			break;
	}
}

function handleLiveMessage(evt, source) {
	if (source !== currentSource) return;
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
			if (msg.running !== feedRunning) {
				feedRunning = msg.running;
				updateUI();
			}
			// Tooltip reflects the live worker's connection state.
			const sourceLabel = source === 'live-kline' ? 'Live (Klines)' : 'Live';
			sourceDropdown.setTooltip(
				msg.connected
					? `Source: ${sourceLabel} (connected)`
					: (msg.running ? `Source: ${sourceLabel} (connecting…)` : `Source: ${sourceLabel}`)
			);
			break;
		case 'error':
			console.error('[live feed]', msg.message);
			break;
	}
}

// ─── DEMO WORKER INITIAL WIRING ───

demoWorker.onmessage = handleDemoMessage;
demoWorker.onerror = (err) => {
	console.error('[demo feed worker]', err.message || err);
};

demoWorker.postMessage({
	type: 'config',
	bucketMs: currentBucketMs(),
	tickMs: VISUAL_UPDATE_MS,
	windowMs: currentWindowMs(),
	eventTimeField: 'eventTime',
	indicators: buildIndicators()
});
demoWorker.postMessage({ type: 'seed' });

// ─── FEED CONTROL ───

function switchSource(newSource) {
	if (newSource === currentSource) return;

	// Pause the current feed if it's running.
	if (feedRunning) {
		stopCurrentWorker();
		feedRunning = false;
	}

	// Disconnect the live source being left so its socket and
	// worker-side state do not continue in the background.
	if (currentSource === 'live' && liveWorker) {
		liveWorker.postMessage({ type: 'disconnect' });
	} else if (currentSource === 'live-kline' && liveKlineWorker) {
		liveKlineWorker.postMessage({ type: 'disconnect' });
	}

	currentSource = newSource;

	if (currentSource === 'live') {
		ensureLiveWorker();
	} else if (currentSource === 'live-kline') {
		ensureLiveKlineWorker();
	}

	updateUI();
}

function toggleFeed() {
	if (feedRunning) {
		stopCurrentWorker();
		feedRunning = false;
	} else {
		startCurrentWorker();
		feedRunning = true;
	}
	updateUI();
}

function startCurrentWorker() {
	if (currentSource === 'demo') {
		demoWorker.postMessage({ type: 'start' });
	} else if (currentSource === 'live' || currentSource === 'live-kline') {
		const w = ensureLiveWorkerForSource(currentSource);
		w.postMessage(liveWorkerConfig(currentSource));
		w.postMessage({ type: 'start' });
	}
}

function stopCurrentWorker() {
	if (currentSource === 'demo') {
		demoWorker.postMessage({ type: 'stop' });
	} else if (currentSource === 'live' && liveWorker) {
		liveWorker.postMessage({ type: 'stop' });
	} else if (currentSource === 'live-kline' && liveKlineWorker) {
		liveKlineWorker.postMessage({ type: 'stop' });
	}
}

function resetData() {
	// Clear the chart up front. The worker reseeds (demo) or
	// reconnects and fetches a fresh seed (live).
	for (const h of activeHandles()) h.setData([]);
	latestRows = priceChart.data;

	if (currentSource === 'demo') {
		demoWorker.postMessage({ type: 'reset' });
	} else if (currentSource === 'live' && liveWorker) {
		liveWorker.postMessage({ type: 'reset' });
	} else if (currentSource === 'live-kline' && liveKlineWorker) {
		liveKlineWorker.postMessage({ type: 'reset' });
	}

	updateUI();
}

function updateUI() {
	// Source dropdown
	sourceDropdown.setValue(currentSource, false);

	// Feed button
	feedButton.setIcon(feedRunning ? 'stop' : 'play');
	feedButton.setTooltip(feedRunning ? 'Pause feed' : 'Start feed');
	feedButton.setSelected(feedRunning);

	// Source-specific tooltip
	// if (currentSource === 'live') {
	// 	sourceDropdown.setTooltip('Source: Live');
	// } else {
	// 	sourceDropdown.setTooltip('Source: Demo');
	// }

	// Demo cluster: enabled only when source === 'demo'.
	const demoEnabled = currentSource === 'demo';
	for (const btn of demoControls) btn.setDisabled(!demoEnabled);

	for (const name of Object.keys(indicatorFactories)) {
		indicatorsChecklist.setChecked(name, !!indicatorInstances[name]);
	}
}

// ─── TOOLBAR ───

const toolbar = new ToolBar({
	id: 'main-toolbar',
	plane,
	position: 'top',
	positionIntent: 'outside'
});

// ─── Viewport controls ───

const panButton = new Button({
	id: 'mode-pan',
	icon: 'pan',
	size: 'sm',
	variant: 'ghost',
	tooltip: 'Pan mode',
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
	tooltip: 'Zoom mode',
	selected: false,
	onClick: () => {
		plane.setInteractionMode('zoom');
		panButton.setSelected(false);
		zoomButton.setSelected(true);
	}
});

const resetViewButton = new Button({
	id: 'mode-reset-view',
	icon: 'reset',
	size: 'sm',
	variant: 'ghost',
	tooltip: 'Reset view',
	onClick: () => plane.resetZoom('both')
});

const crosshairButton = (() => {
	const btn = new Button({
		id: 'toggle-crosshair',
		icon: 'crosshair',
		size: 'sm',
		variant: 'ghost',
		tooltip: 'Toggle crosshair',
		selected: !!plane.getLayer(crosshair.id),
		onClick: () => {
			if (plane.getLayer(crosshair.id)) plane.removeLayer(crosshair);
			else plane.addLayer(crosshair);
			btn.setSelected(!!plane.getLayer(crosshair.id));
		}
	});
	return btn;
})();

const fullscreenButton = new Button({
	id: 'toggle-fullscreen',
	icon: 'fullscreen',
	size: 'sm',
	variant: 'ghost',
	tooltip: 'Enter fullscreen',
	onClick: () => plane.toggleFullscreen()
});

plane.events.on(Events.FULLSCREEN_CHANGED, (data) => {
	fullscreenButton.setIcon(data.fullscreen ? 'fullscreenExit' : 'fullscreen');
	fullscreenButton.setTooltip(data.fullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
});

// ─── View toggles (cards + axes) ───

function makeCardToggle({ id, icon, tooltip, card }) {
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

const legendButton = makeCardToggle({
	id: 'toggle-legend',
	icon: 'legend',
	tooltip: 'Toggle legend',
	card: legendCard
});

const ohlcButton = makeCardToggle({
	id: 'toggle-ohlc',
	icon: 'ohlc',
	tooltip: 'Toggle OHLC',
	card: ohlcCard
});

const infoButton = makeCardToggle({
	id: 'toggle-info',
	icon: 'info',
	tooltip: 'Toggle metrics',
	card: infoCard
});

const indicatorsChecklist = new Checklist({
	id: 'toggle-indicators',
	size: 'sm',
	variant: 'secondary',
	tooltip: 'Toggle chart indicators',
	options: [
		{ value: 'bollinger', label: 'Bollinger', checked: false },
		{ value: 'macd', label: 'MACD', checked: false },
		{ value: 'rsi', label: 'RSI', checked: false },
		{ value: 'sma', label: 'SMA', checked: false },
		{ value: 'vwma', label: 'VWMA', checked: false }
	],
	onChange: (name, enabled) => {
		setIndicatorEnabled(name, enabled);
		updateUI();
	}
});

// ─── Data controls ───

const timeframeDropdown = new Dropdown({
	id: 'ctrl-timeframe',
	icon: 'axisTime',
	size: 'sm',
	variant: 'ghost',
	tooltip: 'Timeframe',
	options: TIMEFRAMES,
	value: currentTimeframe.value,
	onSelect: (value) => {
		const tf = TIMEFRAMES.find(t => t.value === value);
		if (!tf) return;

		currentTimeframe = tf;
		plane.windowSize = tf.windowMs;
		plane.maxData = Math.max(currentMaxData, 7 * tf.windowMs);

		if (currentSource === 'demo') {
			// Demo worker reseeds from scratch with the new
			// bucketMs. The `config` message alone updates the
			// indicator set; the explicit `seed` message triggers
			// a fresh synthetic history. The chart clears on
			// applySeed, then populates.
			demoWorker.postMessage({
				type: 'config',
				bucketMs: currentBucketMs(),
				tickMs: VISUAL_UPDATE_MS,
				windowMs: currentWindowMs(),
				eventTimeField: 'eventTime',
				indicators: buildIndicators()
			});
			demoWorker.postMessage({ type: 'seed' });
		} else if (currentSource === 'live' || currentSource === 'live-kline') {
			// The trade worker rebuckets its buffer; the Kline
			// worker reconnects at the new exchange interval.
			// Both replace the chart data with a fresh seed.
			ensureLiveWorkerForSource(currentSource).postMessage(
				liveWorkerConfig(currentSource)
			);
		}

		// Do NOT clear the chart or touch feedRunning. The active
		// worker replaces its data with a fresh seed.
		updateUI();
	}
});

const maxDataDropdown = new Dropdown({
	id: 'ctrl-maxdata',
	icon: 'strategy',
	size: 'sm',
	variant: 'success',
	tooltip: 'History depth',
	options: MAX_DATA_OPTIONS,
	value: currentMaxData,
	onSelect: (value) => {
		currentMaxData = value;
		const effective = Math.max(value, 7 * currentWindowMs());
		plane.maxData = effective;
		plane.update();
	}
});

const symbolDropdown = new Dropdown({
	id: 'ctrl-symbol',
	icon: 'legend',
	size: 'sm',
	variant: 'secondary',
	tooltip: 'Symbol',
	placeholder: 'Symbol',
	options: SYMBOL_OPTIONS,
	value: currentSymbol,
	onSelect: (value) => {
		currentSymbol = value;
		if ((currentSource === 'live' && liveWorker)
			|| (currentSource === 'live-kline' && liveKlineWorker)) {
			// The active live worker reconnects for this symbol
			// and replaces the chart with a new seed.
			ensureLiveWorkerForSource(currentSource).postMessage(
				liveWorkerConfig(currentSource)
			);
		}
	}
});

const sourceDropdown = new Dropdown({
	id: 'ctrl-source',
	icon: 'source',
	size: 'sm',
	variant: 'ghost',
	tooltip: 'Source',
	options: SOURCE_OPTIONS,
	value: currentSource,
	onSelect: (value) => switchSource(value)
});

const feedButton = new Button({
	id: 'ctrl-feed',
	icon: 'play',
	size: 'sm',
	variant: 'success',
	tooltip: 'Start feed',
	onClick: () => toggleFeed()
});

const resetDataButton = new Button({
	id: 'ctrl-reset-data',
	icon: 'reset',
	size: 'sm',
	variant: 'secondary',
	tooltip: 'Reset data',
	onClick: () => resetData()
});

// ─── Demo controls ───

const addPointButton = new Button({
	id: 'ctrl-add-point',
	icon: 'add',
	size: 'sm',
	variant: 'primary',
	tooltip: 'Add point',
	onClick: () => demoWorker.postMessage({ type: 'tick' })
});

const addBatchButton = new Button({
	id: 'ctrl-add-batch',
	icon: 'batch',
	size: 'sm',
	variant: 'primary',
	tooltip: 'Add 5 points',
	onClick: () => {
		for (let i = 0; i < 5; i++) demoWorker.postMessage({ type: 'tick' });
	}
});

const demoControls = [addPointButton, addBatchButton];

// ─── Toolbar registration ───

const toolGroup = toolbar.getGroup('tool');
toolGroup.addItem(crosshairButton);
toolGroup.addItem(panButton);
toolGroup.addItem(zoomButton);
toolGroup.addItem(resetViewButton);
toolGroup.addItem(fullscreenButton);

const viewGroup = toolbar.addGroup({ id: 'view', label: 'View' });
viewGroup.addItem(legendButton);
viewGroup.addItem(ohlcButton);
viewGroup.addItem(infoButton);
viewGroup.addItem(indicatorsChecklist);

const dataGroup = toolbar.addGroup({ id: 'data', label: 'Data' });
dataGroup.addItem(symbolDropdown);
dataGroup.addItem(timeframeDropdown);
dataGroup.addItem(maxDataDropdown);
dataGroup.addItem(sourceDropdown);
dataGroup.addItem(feedButton);
dataGroup.addItem(resetDataButton);

const demoGroup = toolbar.addGroup({ id: 'demo', label: 'Demo' });
demoGroup.addItem(addPointButton);
demoGroup.addItem(addBatchButton);

plane.addLayer(toolbar);
plane.addLayer(cardStrip);

// ─── Initial UI sync ───

updateUI();

plane.update();

// ─── KEYBOARD SHORTCUTS ───

document.addEventListener('keydown', (e) => {
	if (e.key === ' ' || e.key === 'Space') {
		e.preventDefault();
		toggleFeed();
	}
	if (e.key === 'a' || e.key === 'A') {
		if (currentSource === 'demo') demoWorker.postMessage({ type: 'tick' });
	}
	if (e.key === 'r' || e.key === 'R') resetData();
});