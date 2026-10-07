// ──────────────────────────────────────────────────────────────
// Axis.js
// ──────────────────────────────────────────────────────────────

import { SVG } from '../core/SVG.js';
import { CSS } from '../core/CSS.js';
import { Layer } from '../core/Layer.js';

const css = CSS.axis;

// Tick lengths. Subclasses override the defaults.
export const TICK_LENGTH_MAJOR = 6;
export const TICK_LENGTH_MINOR = 4;
export const TICK_LENGTH_MICRO = 2;

const DEFAULT_TIME_TICK_COUNT = 15;
const DEFAULT_NUMERIC_TICK_COUNT = 12;

const TIME_UNITS = [
	1, 10, 50, 100, 250, 500,
	1000, 2000, 5000, 10000, 15000, 30000,
	60000, 120000, 300000, 600000, 900000, 1800000,
	3600000, 7200000, 10800000, 21600000, 43200000,
	86400000, 172800000, 604800000, 2592000000,
	7776000000, 15552000000, 31536000000
];

const MINUTE_MS = 60000;
const HOUR_MS = 3600000;
const DAY_MS = 86400000;

const EMPTY_TICKS = [];

export class Axis extends Layer {
	constructor(options = {}) {
		super({
			id: options.id,
			type: 'axis',
			name: options.name || 'Axis',
			plane: options.plane,
			onUpdate: options.onUpdate,
			onDestroy: options.onDestroy
		});

		// ─── SCALE ───
		this.scale = options.scale || null;

		// ─── ORIENTATION ───
		this.orientation = options.orientation || 'bottom';
		this.positionIntent = options.positionIntent || 'outside';

		// ─── TICK LENGTHS ───
		this.tickSize = options.tickSize !== undefined ? options.tickSize : null;
		this.minorTickSize = options.minorTickSize !== undefined ? options.minorTickSize : null;
		this.microTickSize = options.microTickSize !== undefined ? options.microTickSize : null;

		// ─── LABELS ───
		this.tickPadding = options.tickPadding || 4;
		this.tickFormat = options.tickFormat || null;
		this.showTicks = options.showTicks !== undefined ? options.showTicks : true;
		this.showTickLabels = options.showTickLabels !== undefined ? options.showTickLabels : true;
		this.tickLabelAlign = options.tickLabelAlign || 'centered';
		this.tickLabelPadding = options.tickLabelPadding !== undefined ? options.tickLabelPadding : 1;

		this.label = options.label || '';
		this.labelOffset = options.labelOffset || 0;
		this.showLabel = options.showLabel !== undefined ? options.showLabel : true;
		this.showGrid = options.showGrid !== undefined ? options.showGrid : false;
		this.bandGroupId = options.bandGroupId || null;

		// ─── FONT SIZE ───
		// Resolved once from CSS. Feeds tick-spacing math and label
		// placement. A missing variable throws in CSS.getNumber.
		this.fontSize = options.fontSize !== undefined
			? options.fontSize
			: CSS.getNumber('--axis-font-size');

		// ─── DECIMALS ───
		this._decimalsExplicit = options.decimals !== undefined;
		this.decimals = options.decimals !== undefined ? options.decimals : 2;

		// ─── TICK CONFIG ───
		this.tickCount = options.tickCount || null;
		this._minMajorSpacing = options.minMajorSpacing;
		this.tickStepMode = options.tickStepMode || 'nice';
		this.tickUnit = options.tickUnit || 'metric';
		this.timeInterval = options.timeInterval || null;

		// ─── TIER VISIBILITY ───
		this.showMinorTicks = options.showMinorTicks !== undefined ? options.showMinorTicks : true;
		this.showMicroTicks = options.showMicroTicks !== undefined ? options.showMicroTicks : true;

		// ─── DOM POOLS ───
		this._elements = {
			group: null,
			axisLine: null,
			label: null,
			tickLines: [],
			tickLabels: [],
			gridLines: [],
			minorTickLines: [],
			microTickLines: []
		};

		// ─── CACHES ───
		this._contentCreated = false;
		this._cachedScaleDomain = null;
		this._cachedScaleRange = null;
		this._cachedBounds = null;
		this._cachedDecimals = null;
		this._cachedPlotKey = null;
		this._lastMarginSig = null;
		this._dirty = true;

		// ─── TIER CACHE ───
		this._tierKey = null;
		this._tierMajorTicks = null;
		this._tierMinorTicks = null;
		this._tierMicroTicks = null;
		this._tierDecimals = 2;
		this._tierGenDecimals = 2;
		this._tierMajorPixels = null;
		this._tierMinorPixels = null;
		this._tierMicroPixels = null;
		this._tierView = {
			majorTicks: EMPTY_TICKS,
			minorTicks: EMPTY_TICKS,
			microTicks: EMPTY_TICKS,
			decimals: 2
		};

		// ─── PRECOMPUTED CLASS STRING ───
		this._tickLabelClass = this.positionIntent === 'inside'
			? css.tickLabelInside
			: css.tickLabelOutside;
	}

	// ─── Abstract ───
	_renderAxisOrientation() {
		throw new Error('Axis._renderAxisOrientation must be overridden');
	}

	_getMajorTickLength() {
		return this.tickSize !== null ? this.tickSize : TICK_LENGTH_MAJOR;
	}

	_getMinorTickLength() {
		return this.minorTickSize !== null ? this.minorTickSize : TICK_LENGTH_MINOR;
	}

	_getMicroTickLength() {
		return this.microTickSize !== null ? this.microTickSize : TICK_LENGTH_MICRO;
	}

	// ─── Tick density ───
	_getMinMajorSpacing() {
		if (this._minMajorSpacing !== undefined) return this._minMajorSpacing;
		return this.fontSize * 1.5;
	}

	_computeMaxTicks() {
		const pixelLength = this._getPixelLength();
		const minSpacing = this._getMinMajorSpacing();
		if (!isFinite(pixelLength) || pixelLength <= 0) return Infinity;
		if (!isFinite(minSpacing) || minSpacing <= 0) return Infinity;
		return Math.max(2, Math.floor(pixelLength / minSpacing));
	}

	_getPixelLength() {
		const orientation = this.orientation;
		if (orientation === 'bottom' || orientation === 'top') {
			return Math.abs(this.scale.range[1] - this.scale.range[0]);
		}
		const bb = this._getBandBounds();
		if (bb) return bb.height;
		return Math.abs(this.scale.range[1] - this.scale.range[0]);
	}

	_getBandBounds() {
		const plane = this.plane;
		if (!plane || !this.bandGroupId) return null;

		const groups = plane._yGroups;
		if (!groups) return null;

		const group = groups[this.bandGroupId];
		if (!group) return null;

		const top = group._yTop;
		const bottom = group._yBottom;
		if (!isFinite(top) || !isFinite(bottom) || bottom <= top) return null;

		return { top, bottom, height: bottom - top };
	}

	// ─── Time interval ───
	setTimeInterval(intervalMs) {
		if (intervalMs === this.timeInterval) return this;
		this.timeInterval = intervalMs;
		this._dirty = true;
		this._invalidateTierCache();
		const plane = this.plane;
		if (plane && plane.markMarginsDirty) plane.markMarginsDirty();
		this.update();
		return this;
	}

	// ─── Scale type ───
	_isTimeScale() {
		return this.scale !== null && this.scale.type === 'time';
	}

	// ─── Decimals ───
	_getEffectiveDecimals() {
		if (this._decimalsExplicit) return this.decimals;

		let declared = this.decimals;
		const plane = this.plane;
		if (this.bandGroupId && plane && plane._yGroups) {
			const group = plane._yGroups[this.bandGroupId];
			if (group && group.decimals !== undefined) {
				declared = group.decimals;
			}
		}

		let derived = declared;
		const scale = this.scale;
		if (scale && scale.domain) {
			const dMin = scale.domain[0];
			const dMax = scale.domain[1];
			const domainLength = dMax > dMin ? dMax - dMin : dMin - dMax;
			if (domainLength > 0 && isFinite(domainLength)) {
				const needed = Math.max(0, Math.ceil(-Math.log10(domainLength)) + 1);
				if (needed > derived) derived = needed;
			}
		}

		return derived;
	}

	_formatTick(value, decimals) {
		if (this.tickFormat) return this.tickFormat(value);
		return value.toFixed(decimals !== undefined ? decimals : this._getEffectiveDecimals());
	}

	// ─── Generation precision ───
	_timeGenDecimals(step) {
		if (step >= 1000) return 0;
		if (step >= 100) return 1;
		if (step >= 10) return 2;
		if (step >= 1) return 3;
		return 6;
	}

	_decimalGenDecimals(step) {
		if (!isFinite(step) || step <= 0) return 10;
		const exp = Math.floor(Math.log10(step));
		return Math.max(0, -exp + 1);
	}

	// ─── Step snapping ───
	_snapToNiceStep(step) {
		if (step <= 0 || !isFinite(step)) return 1;
		if (this.tickUnit === 'imperial') return this._snapToImperialStep(step);
		return this._snapToMetricNiceStep(step);
	}

	_snapToMetricNiceStep(step) {
		const exponent = Math.floor(Math.log10(step));
		const fraction = step / Math.pow(10, exponent);
		let mantissa;
		if (fraction < 1.5) mantissa = 1;
		else if (fraction < 3.5) mantissa = 2;
		else if (fraction < 7.5) mantissa = 5;
		else mantissa = 10;
		return mantissa * Math.pow(10, exponent);
	}

	_snapToImperialStep(step) {
		// Reserved. Falls back to metric until a ladder is defined.
		return this._snapToMetricNiceStep(step);
	}

	// ─── Time-step ───
	_snapToTimeStep(step) {
		for (let i = 0, len = TIME_UNITS.length; i < len; i++) {
			if (step <= TIME_UNITS[i]) return TIME_UNITS[i];
		}
		return TIME_UNITS[TIME_UNITS.length - 1];
	}

	_snapToTimeMinor(majorStep) {
		const preferred = [5, 4, 3, 2];
		for (let i = 0; i < preferred.length; i++) {
			const candidate = majorStep / preferred[i];
			for (let j = 0, len = TIME_UNITS.length; j < len; j++) {
				if (Math.abs(TIME_UNITS[j] - candidate) / TIME_UNITS[j] < 0.2) {
					return TIME_UNITS[j];
				}
			}
		}
		return majorStep / 2;
	}

	// ─── Time boundary alignment ───
	_alignToTimeBoundary(timestamp, step) {
		if (step < MINUTE_MS) {
			if (step >= 1000) {
				const minuteStart = Math.floor(timestamp / MINUTE_MS) * MINUTE_MS;
				const offset = timestamp - minuteStart;
				const alignedOffset = Math.ceil(offset / step) * step;
				return minuteStart + alignedOffset;
			}
			return Math.ceil(timestamp / step) * step;
		}

		if (step < HOUR_MS) {
			const stepMinutes = Math.round(step / MINUTE_MS);
			const epochMinutes = Math.floor(timestamp / MINUTE_MS);
			const remainder = epochMinutes % stepMinutes;
			const nextMinutes = remainder === 0
				? epochMinutes
				: epochMinutes + (stepMinutes - remainder);
			let aligned = nextMinutes * MINUTE_MS;
			while (aligned < timestamp) aligned += step;
			return aligned;
		}

		if (step < DAY_MS) {
			const stepHours = Math.round(step / HOUR_MS);
			const epochHours = Math.floor(timestamp / HOUR_MS);
			const remainder = epochHours % stepHours;
			const nextHours = remainder === 0
				? epochHours
				: epochHours + (stepHours - remainder);
			let aligned = nextHours * HOUR_MS;
			while (aligned < timestamp) aligned += step;
			return aligned;
		}

		const stepDays = Math.round(step / DAY_MS);
		const epochDays = Math.floor(timestamp / DAY_MS);
		const remainder = epochDays % stepDays;
		const nextDays = remainder === 0
			? epochDays
			: epochDays + (stepDays - remainder);
		let aligned = nextDays * DAY_MS;
		while (aligned < timestamp) aligned += step;
		return aligned;
	}

	// ─── Tier computation ───
	_computeTickTiers() {
		const scale = this.scale;
		const dMin = scale.domain[0];
		const dMax = scale.domain[1];
		const domainLength = dMax > dMin ? dMax - dMin : dMin - dMax;
		const decimals = this._getEffectiveDecimals();
		const isTime = this._isTimeScale();

		if (domainLength === 0 || !isFinite(domainLength)) {
			return {
				majorStep: isTime ? MINUTE_MS : 1,
				minorStep: null,
				microStep: null,
				decimals,
				genDecimals: decimals
			};
		}

		const preferredTicks = this.tickCount
			? this.tickCount
			: (isTime ? DEFAULT_TIME_TICK_COUNT : DEFAULT_NUMERIC_TICK_COUNT);

		const maxTicks = this._computeMaxTicks();
		const effectiveTickCount = Math.max(2, Math.min(preferredTicks, maxTicks));

		if (isTime) {
			return this._computeTimeTiers(domainLength, effectiveTickCount, decimals);
		}
		if (this.tickStepMode === 'decimal') {
			return this._computeDecimalTiers(domainLength, effectiveTickCount, decimals);
		}
		return this._computeNiceTiers(domainLength, effectiveTickCount, decimals);
	}

	_computeNiceTiers(domainLength, tickCount, decimals) {
		const idealStep = domainLength / tickCount;
		const majorStep = this._snapToNiceStep(idealStep);

		let minorStep = null;
		if (this.showMinorTicks) {
			const candidate = majorStep / 5;
			const minStep = Math.pow(10, -decimals);
			if (candidate > 0 && candidate >= minStep) minorStep = candidate;
		}

		return {
			majorStep,
			minorStep,
			microStep: null,
			decimals,
			genDecimals: decimals
		};
	}

	_computeDecimalTiers(domainLength, tickCount, decimals) {
		if (this.tickUnit === 'imperial' && !this._warnedDecimalImperial) {
			this._warnedDecimalImperial = true;
			console.warn(
				`Axis "${this.id}": tickStepMode "decimal" with tickUnit ` +
				`"imperial" is not supported. Falling back to metric ticks.`
			);
		}

		const targetMicro = domainLength / (tickCount * 10);
		const exp = Math.ceil(Math.log10(targetMicro));

		if (!isFinite(exp)) {
			const majorStep = this._snapToNiceStep(domainLength / tickCount);
			return {
				majorStep,
				minorStep: null,
				microStep: null,
				decimals,
				genDecimals: decimals
			};
		}

		const microStep = Math.pow(10, exp);
		const minorStep = microStep * 5;
		const majorStep = microStep * 10;

		return {
			majorStep,
			minorStep: this.showMinorTicks ? minorStep : null,
			microStep: this.showMicroTicks ? microStep : null,
			decimals,
			genDecimals: this._decimalGenDecimals(microStep)
		};
	}

	_computeTimeTiers(domainLength, tickCount, decimals) {
		let idealStep;
		if (this.timeInterval) {
			const squeezed = domainLength / tickCount;
			idealStep = this.timeInterval > squeezed ? this.timeInterval : squeezed;
		} else {
			idealStep = domainLength / tickCount;
		}

		const majorStep = this._snapToTimeStep(idealStep);

		let minorStep = null;
		let microStep = null;

		if (this.showMinorTicks) {
			minorStep = this._snapToTimeMinor(majorStep);
			if (minorStep >= majorStep) minorStep = null;
		}

		if (this.showMicroTicks && minorStep) {
			const candidate = minorStep / 2;
			for (let j = 0, len = TIME_UNITS.length; j < len; j++) {
				if (TIME_UNITS[j] === candidate) {
					microStep = candidate;
					break;
				}
			}
		}

		return {
			majorStep,
			minorStep,
			microStep,
			decimals,
			genDecimals: this._timeGenDecimals(microStep || minorStep || majorStep)
		};
	}

	// ─── Tick generation ───
	_generateTicksWithStep(step, genDecimals) {
		const scale = this.scale;
		const dMin = scale.domain[0];
		const dMax = scale.domain[1];
		const isTime = this._isTimeScale();

		const out = [];
		const epsilon = step * 1e-10;

		let start;
		if (isTime) {
			start = this._alignToTimeBoundary(dMin, step);
		} else {
			start = Math.ceil(dMin / step) * step;
		}

		let tick = start;
		while (tick <= dMax + epsilon) {
			out.push(Number(tick.toFixed(genDecimals)));
			tick += step;
		}

		return out;
	}

	_generateTieredTicks(step, minorEvery, majorEvery, genDecimals) {
		const micros = [];
		const minors = [];
		const majors = [];

		if (!step || step <= 0) return { micros, minors, majors };

		const scale = this.scale;
		const isTime = this._isTimeScale();
		const dMin = scale.domain[0];
		const dMax = scale.domain[1];
		const epsilon = step * 1e-10;

		let start;
		if (isTime) {
			start = this._alignToTimeBoundary(dMin, step);
		} else {
			start = Math.ceil(dMin / step) * step;
		}

		const startIndex = Math.round(start / step);
		let i = 0;
		let tick = start;
		while (tick <= dMax + epsilon) {
			const v = Number(tick.toFixed(genDecimals));
			const idx = startIndex + i;

			if (idx % majorEvery === 0) majors.push(v);
			else if (idx % minorEvery === 0) minors.push(v);
			else micros.push(v);

			i++;
			tick += step;
		}

		return { micros, minors, majors };
	}

	// ─── Tier cache ───
	_invalidateTierCache() {
		this._tierKey = null;
		this._tierMajorTicks = null;
		this._tierMinorTicks = null;
		this._tierMicroTicks = null;
		this._tierMajorPixels = null;
		this._tierMinorPixels = null;
		this._tierMicroPixels = null;
	}

	_tierCacheKey(tiers) {
		const d = this.scale.domain;
		const r = this.scale.range;
		const bb = this._getBandBounds();
		const boundsKey = bb ? `${bb.top},${bb.bottom}` : '';
		return (
			d[0] + ',' + d[1] + '|' +
			r[0] + ',' + r[1] + '|' +
			boundsKey + '|' +
			tiers.majorStep + ',' + (tiers.minorStep || 0) + ',' +
			(tiers.microStep || 0) + ',' +
			tiers.decimals + ',' + tiers.genDecimals
		);
	}

	_computePixelArray(ticks) {
		const scale = this.scale;
		const out = new Array(ticks.length);
		for (let i = 0, len = ticks.length; i < len; i++) {
			out[i] = scale.toScreen(ticks[i]);
		}
		return out;
	}

	_getTickTiers() {
		if (!this.scale) {
			this._tierView.majorTicks = EMPTY_TICKS;
			this._tierView.minorTicks = EMPTY_TICKS;
			this._tierView.microTicks = EMPTY_TICKS;
			this._tierView.decimals = 2;
			return this._tierView;
		}

		const tiers = this._computeTickTiers();
		const key = this._tierCacheKey(tiers);

		if (this._tierKey !== key) {
			this._tierKey = key;
			this._tierDecimals = tiers.decimals;
			this._tierGenDecimals = tiers.genDecimals;

			if (tiers.microStep) {
				const minorEvery = Math.round(tiers.minorStep / tiers.microStep);
				const majorEvery = Math.round(tiers.majorStep / tiers.microStep);
				const result = this._generateTieredTicks(
					tiers.microStep, minorEvery, majorEvery, tiers.genDecimals
				);
				this._tierMicroTicks = result.micros;
				this._tierMinorTicks = result.minors;
				this._tierMajorTicks = result.majors;
			} else {
				this._tierMajorTicks = this._generateTicksWithStep(
					tiers.majorStep, tiers.genDecimals
				);
				this._tierMinorTicks = this._generateMinorTicks(
					tiers.majorStep, tiers.minorStep, tiers.genDecimals
				);
				this._tierMicroTicks = EMPTY_TICKS;
			}

			this._tierMajorPixels = this._computePixelArray(this._tierMajorTicks);
			this._tierMinorPixels = this._computePixelArray(this._tierMinorTicks);
			this._tierMicroPixels = this._computePixelArray(this._tierMicroTicks);
		}

		const view = this._tierView;
		view.majorTicks = this._tierMajorTicks;
		view.minorTicks = this._tierMinorTicks;
		view.microTicks = this._tierMicroTicks;
		view.decimals = this._tierDecimals;
		return view;
	}

	_generateMinorTicks(majorStep, minorStep, genDecimals) {
		if (!minorStep) return [];

		const majorTicks = this._generateTicksWithStep(majorStep, genDecimals);
		const majorSet = Object.create(null);
		for (let i = 0, len = majorTicks.length; i < len; i++) {
			majorSet[majorTicks[i]] = true;
		}

		const scale = this.scale;
		const isTime = this._isTimeScale();
		const dMin = scale.domain[0];
		const dMax = scale.domain[1];
		const minorTicks = [];
		const epsilon = minorStep * 1e-10;

		let start;
		if (isTime) {
			start = this._alignToTimeBoundary(dMin, minorStep);
		} else {
			start = Math.ceil(dMin / minorStep) * minorStep;
		}

		let tick = start;
		while (tick <= dMax + epsilon) {
			const v = Number(tick.toFixed(genDecimals));
			if (majorSet[v] !== true) minorTicks.push(v);
			tick += minorStep;
		}

		return minorTicks;
	}

	// ─── Margin request ───
	getMarginRequest() {
		if (this.positionIntent === 'inside' || !this.scale) return null;

		const tiers = this._getTickTiers();
		const ticks = tiers.majorTicks;
		const decimals = tiers.decimals;
		const fontSize = this.fontSize;

		let maxLabelWidth = 0;
		const maxLabelHeight = fontSize + 2;

		for (let i = 0, len = ticks.length; i < len; i++) {
			const labelText = this._formatTick(ticks[i], decimals);
			const estimatedWidth = labelText.length * (fontSize * 0.6) + 2;
			if (estimatedWidth > maxLabelWidth) maxLabelWidth = estimatedWidth;
		}

		const axisLabelSize = (this.showLabel && this.label) ? (fontSize + 2) : 0;
		const majorTickLength = this._getMajorTickLength();
		const tickPadding = this.tickPadding;

		let totalSize;
		const orientation = this.orientation;
		if (orientation === 'bottom' || orientation === 'top') {
			totalSize = majorTickLength + tickPadding + maxLabelHeight +
				tickPadding + axisLabelSize + 2;
		} else {
			totalSize = majorTickLength + tickPadding + maxLabelWidth +
				tickPadding + axisLabelSize + 2;
		}

		const margin = {};
		switch (orientation) {
			case 'bottom': margin.bottom = totalSize; break;
			case 'top': margin.top = totalSize; break;
			case 'left': margin.left = totalSize; break;
			case 'right': margin.right = totalSize; break;
		}
		return margin;
	}

	// ─── Pool management ───
	_growPool(pool, count, createFn, parent) {
		while (pool.length < count) {
			const el = createFn();
			SVG.append(parent, el);
			pool.push(el);
		}
	}

	_hidePoolFrom(pool, from) {
		for (let i = from, len = pool.length; i < len; i++) {
			pool[i].setAttribute('visibility', 'hidden');
		}
	}

	// ─── Lifecycle ───
	render(container) {
		if (!this.scale) throw new Error('Axis: scale must be provided.');

		if (!this._contentCreated) {
			this._createContent(container);
			this._contentCreated = true;
		} else if (this._elements.group && !this._elements.group.parentNode) {
			SVG.append(container, this._elements.group);
		}

		this._renderAxis();
		return this._elements.group;
	}

	_createContent(container) {
		const g = SVG.create('g', {
			id: `${this.id}-group`,
			class: css.axis
		});
		SVG.append(container, g);
		this._elements.group = g;

		this._elements.axisLine = SVG.create('line', {
			id: `${this.id}-axis-line`,
			class: css.axisLine
		});
		SVG.append(g, this._elements.axisLine);

		if (this.showLabel && this.label) {
			const labelEl = SVG.create('text', {
				id: `${this.id}-label`,
				class: css.axisLabel
			});
			labelEl.textContent = this.label;
			SVG.append(g, labelEl);
			this._elements.label = labelEl;
		}
	}

	_renderAxis() {
		if (!this.scale) return false;

		const scale = this.scale;
		const plane = this.plane;
		const plotKey = plane
			? `${plane.plotLeft},${plane.plotRight},${plane.plotTop},${plane.plotBottom}`
			: '';

		const currentDomain = scale.domain[0] + ',' + scale.domain[1];
		const currentRange = scale.range[0] + ',' + scale.range[1];
		const bb = this._getBandBounds();
		const boundsKey = bb ? `${bb.top},${bb.bottom}` : '';
		const decimalsKey = String(this._getEffectiveDecimals());

		if (this._cachedPlotKey === plotKey &&
			this._cachedScaleDomain === currentDomain &&
			this._cachedScaleRange === currentRange &&
			this._cachedBounds === boundsKey &&
			this._cachedDecimals === decimalsKey &&
			!this._dirty) {
			return false;
		}

		this._cachedPlotKey = plotKey;
		this._cachedScaleDomain = currentDomain;
		this._cachedScaleRange = currentRange;
		this._cachedBounds = boundsKey;
		this._cachedDecimals = decimalsKey;
		this._dirty = false;

		this._renderAxisOrientation();
		return true;
	}

	update() {
		if (!this._contentCreated) {
			const plane = this.plane;
			if (plane) this.render(plane._elements.rootGroup);
			return this;
		}

		const didRender = this._renderAxis();
		this._updateCount++;

		if (!didRender) return this;

		if (this.onUpdate) this.onUpdate(this);

		const req = this.getMarginRequest();
		const sig = req
			? (req.top || 0) + '|' + (req.bottom || 0) + '|' +
			(req.left || 0) + '|' + (req.right || 0)
			: 'null';

		if (sig !== this._lastMarginSig) {
			this._lastMarginSig = sig;
			const plane = this.plane;
			if (plane && plane.markMarginsDirty) plane.markMarginsDirty();
		}

		return this;
	}

	forceUpdate() {
		this._dirty = true;
		this._cachedScaleDomain = null;
		this._cachedScaleRange = null;
		this._cachedBounds = null;
		this._cachedDecimals = null;
		this._cachedPlotKey = null;
		this._invalidateTierCache();
		this.update();
		return this;
	}

	// ─── Snap ───
	_snapBinary(pixels, pixel, tolerance) {
		let best = null;
		let lo = 0, hi = pixels.length - 1;
		while (lo <= hi) {
			const mid = (lo + hi) >>> 1;
			const px = pixels[mid];
			const dist = px > pixel ? px - pixel : pixel - px;
			if (dist <= tolerance) {
				best = { idx: mid, dist };
				break;
			}
			if (px < pixel) lo = mid + 1;
			else hi = mid - 1;
		}
		return best;
	}

	snapToPixel(pixel) {
		if (!this.scale) return null;

		if (this._tierMajorPixels === null) this._getTickTiers();

		const tolerance = Math.max(3, this.fontSize / 2);
		const decimals = this._tierDecimals;

		const major = this._snapBinary(this._tierMajorPixels, pixel, tolerance);
		if (major) {
			const v = this._tierMajorTicks[major.idx];
			return { value: v, tier: 'major', label: this._formatTick(v, decimals) };
		}

		const minor = this._snapBinary(this._tierMinorPixels, pixel, tolerance);
		if (minor) {
			const v = this._tierMinorTicks[minor.idx];
			return { value: v, tier: 'minor', label: this._formatTick(v, decimals) };
		}

		const micro = this._snapBinary(this._tierMicroPixels, pixel, tolerance);
		if (micro) {
			const v = this._tierMicroTicks[micro.idx];
			return { value: v, tier: 'micro', label: this._formatTick(v, decimals) };
		}

		return null;
	}

	// ─── Destroy ───
	destroy() {
		super.destroy();
		const group = this._elements.group;
		if (group && group.parentNode) group.parentNode.removeChild(group);

		this._elements = {
			group: null,
			axisLine: null,
			label: null,
			tickLines: [],
			tickLabels: [],
			gridLines: [],
			minorTickLines: [],
			microTickLines: []
		};
		this._contentCreated = false;
		this._invalidateTierCache();
	}
}

export default Axis;