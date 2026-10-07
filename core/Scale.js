// ──────────────────────────────────────────────────────────────
// Scale.js - Supports linear, ordinal, and time types
// ──────────────────────────────────────────────────────────────

import { Utils } from './Utils.js';

export class Scale {
	constructor(options = {}) {
		this._domain = options.domain || [0, 1];
		this._range = options.range || [0, 100];
		this.type = options.type || 'linear';
		this.spacing = options.spacing !== undefined ? options.spacing : 0.1;
		this.space = options.space || 'cartesian';
		this.decimals = options.decimals !== undefined ? options.decimals : 2;
	}

	get domain() { return this._domain; }
	set domain(value) {
		if (!Array.isArray(value) || value.length < 2) {
			throw new Error('Domain must be an array with at least 2 values');
		}
		this._domain = value;
	}

	get range() { return this._range; }
	set range(value) {
		if (!Array.isArray(value) || value.length < 2) {
			throw new Error('Range must be an array with at least 2 values');
		}
		this._range = value;
	}

	toScreen(value) {
		if (this.type === 'ordinal') {
			return this._ordinalToScreen(value);
		}
		return this._linearToScreen(value);
	}

	toData(value) {
		if (this.type === 'ordinal') {
			return this._ordinalToData(value);
		}
		return this._linearToData(value);
	}

	_linearToScreen(value) {
		const [dMin, dMax] = this._domain;
		const [rMin, rMax] = this._range;
		const dRange = dMax - dMin || 1;
		return rMin + ((value - dMin) / dRange) * (rMax - rMin);
	}

	_linearToData(value) {
		const [dMin, dMax] = this._domain;
		const [rMin, rMax] = this._range;
		const rRange = rMax - rMin || 1;
		return dMin + ((value - rMin) / rRange) * (dMax - dMin);
	}

	_ordinalToScreen(value) {
		const domain = this._domain;
		const range = this._range;
		const index = domain.indexOf(value);
		if (index === -1) return range[0];

		const step = (range[1] - range[0]) / (domain.length + this.spacing);
		return range[0] + step * (index + this.spacing / 2);
	}

	_ordinalToData(value) {
		const domain = this._domain;
		const range = this._range;
		const step = (range[1] - range[0]) / (domain.length + this.spacing);
		const index = Math.floor((value - range[0]) / step);
		return domain[Utils.clamp(index, 0, domain.length - 1)];
	}

	// ─── Calculate time-specific nice steps ───
	_calculateTimeStep(step) {
		// Common time units in milliseconds
		const units = [
			{ name: 'ms', value: 1 },
			{ name: 'second', value: 1000 },
			{ name: 'minute', value: 60000 },
			{ name: 'hour', value: 3600000 },
			{ name: 'day', value: 86400000 }
		];

		// Find the appropriate unit (largest unit that fits in the step)
		let bestUnit = units[0];
		for (let i = units.length - 1; i >= 0; i--) {
			if (step >= units[i].value) {
				bestUnit = units[i];
				break;
			}
		}

		// Calculate step in terms of the unit
		const stepInUnits = step / bestUnit.value;

		// Find nice multiplier (1, 2, 5, 10, 15, 20, 30, 60)
		let multiplier;
		if (stepInUnits < 1.5) multiplier = 1;
		else if (stepInUnits < 3.5) multiplier = 2;
		else if (stepInUnits < 7.5) multiplier = 5;
		else if (stepInUnits < 12.5) multiplier = 10;
		else if (stepInUnits < 17.5) multiplier = 15;
		else if (stepInUnits < 25) multiplier = 20;
		else if (stepInUnits < 35) multiplier = 30;
		else multiplier = 60;

		return multiplier * bestUnit.value;
	}

	// ─── Calculate nice step for different types ───
	// In Scale.js - _calculateNiceStep()
	_calculateNiceStep(range) {
		if (range <= 0) return 1;

		const targetTicks = 10;
		let step = range / targetTicks;

		// ─── LINEAR type: use standard nice steps (1, 2, 5, 10) ───
		const exponent = Math.floor(Math.log10(Math.abs(step)));
		const fraction = step / Math.pow(10, exponent);
		let niceFraction;

		if (fraction < 1.5) niceFraction = 1;
		else if (fraction < 3.5) niceFraction = 2;
		else if (fraction < 7.5) niceFraction = 5;
		else niceFraction = 10;

		let niceStep = niceFraction * Math.pow(10, exponent);

		// Ensure step respects decimal precision
		const baseUnit = Math.pow(10, -this.decimals);
		if (niceStep < baseUnit) {
			niceStep = baseUnit * 10;
		}

		// ─── Ensure we have between 8 and 12 ticks ───
		let tickCount = range / niceStep;
		if (tickCount < 8) {
			// Too few ticks, try smaller step
			const smallerFractions = [0.5, 0.2, 0.1];
			for (const frac of smallerFractions) {
				const testStep = niceStep * frac;
				const testCount = range / testStep;
				if (testCount >= 8 && testCount <= 12) {
					return testStep;
				}
			}
			// Fall back to dividing by 2
			if (niceStep > baseUnit) {
				return niceStep / 2;
			}
		}
		if (tickCount > 12) {
			// Too many ticks, try larger step
			const largerFractions = [2, 5, 10];
			for (const frac of largerFractions) {
				const testStep = niceStep * frac;
				const testCount = range / testStep;
				if (testCount >= 8 && testCount <= 12) {
					return testStep;
				}
			}
			// Fall back to multiplying by 2
			return niceStep * 2;
		}

		return niceStep;
	}

	// ─── Get exact ticks ───
	getTicks(count = 10) {
		if (this.type === 'ordinal') {
			return this._domain;
		}

		const [dMin, dMax] = this._domain;
		const dRange = dMax - dMin;

		if (dRange === 0 || !isFinite(dRange)) {
			return [dMin];
		}

		const step = dRange / count;
		const ticks = {};
		const epsilon = step * 1e-10;

		// For time type, align to a clean boundary
		let start = Math.ceil(dMin / step) * step;
		if (this.type === 'time') {
			// Find the unit
			const units = [1, 1000, 60000, 3600000, 86400000];
			let unit = units[0];
			for (const u of units) {
				if (step >= u) unit = u;
			}
			start = Math.floor(dMin / unit) * unit;
			while (start < dMin) {
				start += step;
			}
		}

		let tick = start;

		while (tick <= dMax + epsilon) {
			const v = Number(tick.toFixed(this.decimals));
			ticks[v] = v;
			tick += step;
		}

		return Object.values(ticks);
	}

	// ─── Get nice ticks ───
	getNiceTicks(count = 10) {
		if (this.type === 'ordinal') {
			return this._domain;
		}

		const [dMin, dMax] = this._domain;
		const dRange = dMax - dMin;

		if (dRange === 0 || !isFinite(dRange)) {
			return [dMin];
		}

		const step = this._calculateNiceStep(dRange);
		const ticks = {};
		const epsilon = step * 1e-10;

		// For time type, align to a clean boundary
		let start = Math.ceil(dMin / step) * step;
		if (this.type === 'time') {
			// Find the unit
			const units = [1, 1000, 60000, 3600000, 86400000];
			let unit = units[0];
			for (const u of units) {
				if (step >= u) unit = u;
			}
			start = Math.floor(dMin / unit) * unit;
			while (start < dMin) {
				start += step;
			}
		}

		let tick = start;

		while (tick <= dMax + epsilon) {
			const v = Number(tick.toFixed(this.decimals));
			ticks[v] = v;
			tick += step;
		}

		return Object.values(ticks);
	}

	// ─── Get ticks within screen range ───
	// ─── Get nice ticks within screen range ───
	// ─── Get nice ticks within screen range ───
	getNiceTicksInRange(count = 10, screenMin, screenMax) {
		if (this.type === 'ordinal') {
			return this._domain;
		}

		const [dMin, dMax] = this._domain;
		const [rMin, rMax] = this._range;
		const dRange = dMax - dMin;

		if (dRange === 0 || !isFinite(dRange)) {
			return [dMin];
		}

		const rRange = rMax - rMin || 1;

		// ─── If screen bounds are provided, clamp the data range ───
		let dataMin = dMin;
		let dataMax = dMax;

		if (screenMin !== undefined && screenMax !== undefined) {
			// Convert screen bounds to data values
			// IMPORTANT: screenMin and screenMax are in the scale's range space
			dataMin = dMin + ((screenMin - rMin) / rRange) * dRange;
			dataMax = dMin + ((screenMax - rMin) / rRange) * dRange;

			// Ensure min < max
			if (dataMin > dataMax) {
				const temp = dataMin;
				dataMin = dataMax;
				dataMax = temp;
			}

			// Clamp to domain
			dataMin = Math.max(dMin, dataMin);
			dataMax = Math.min(dMax, dataMax);
		}

		const visibleRange = dataMax - dataMin;
		if (visibleRange <= 0) {
			return [dataMin];
		}

		const step = this._calculateNiceStep(visibleRange);
		const ticks = {};
		const epsilon = step * 1e-10;

		// ─── Align to a clean boundary ───
		let start = Math.ceil(dataMin / step) * step;
		if (this.type === 'time') {
			// For time, align to clean time units
			const units = [1, 1000, 60000, 3600000, 86400000];
			let unit = units[0];
			for (const u of units) {
				if (step >= u) unit = u;
			}
			start = Math.floor(dataMin / unit) * unit;
			while (start < dataMin) {
				start += step;
			}
		}

		let tick = start;

		while (tick <= dataMax + epsilon) {
			const v = Number(tick.toFixed(this.decimals));
			ticks[v] = v;
			tick += step;
		}

		return Object.values(ticks);
	}

	// ─── Get nice ticks within screen range ───
	getNiceTicksInRange(count = 10, screenMin, screenMax) {
		if (this.type === 'ordinal') {
			return this._domain;
		}

		const [dMin, dMax] = this._domain;
		const [rMin, rMax] = this._range;
		const dRange = dMax - dMin;

		if (dRange === 0 || !isFinite(dRange)) {
			return [dMin];
		}

		const rRange = rMax - rMin || 1;
		let dataMin = screenMin !== undefined ? dMin + ((screenMin - rMin) / rRange) * dRange : dMin;
		let dataMax = screenMax !== undefined ? dMin + ((screenMax - rMin) / rRange) * dRange : dMax;

		// Clamp to domain
		dataMin = Math.max(dMin, dataMin);
		dataMax = Math.min(dMax, dataMax);

		const visibleRange = dataMax - dataMin;
		if (visibleRange <= 0) {
			return [dataMin];
		}

		const step = this._calculateNiceStep(visibleRange);
		const ticks = {};
		const epsilon = step * 1e-10;

		// For time type, align to a clean boundary
		let start = Math.ceil(dataMin / step) * step;
		if (this.type === 'time') {
			// Find the unit that matches the step
			const units = [1, 1000, 60000, 3600000, 86400000];
			let unit = units[0];
			for (const u of units) {
				if (step >= u) unit = u;
			}
			// Align to the unit boundary
			start = Math.floor(dataMin / unit) * unit;
			// Then step up by the step size
			while (start < dataMin) {
				start += step;
			}
		}

		let tick = start;

		while (tick <= dataMax + epsilon) {
			const v = Number(tick.toFixed(this.decimals));
			ticks[v] = v;
			tick += step;
		}

		return Object.values(ticks);
	}

	destroy() {
		this._domain = null;
		this._range = null;
	}
}

export default Scale;