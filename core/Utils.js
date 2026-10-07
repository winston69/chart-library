// ──────────────────────────────────────────────────────────────
// Utils.js - Extended with Chart Helpers
// ──────────────────────────────────────────────────────────────

// Cache Math methods for performance
const { min: _min, max: _max, abs: _abs, round: _round, floor: _floor, ceil: _ceil, sqrt: _sqrt, pow: _pow } = Math;

export const Utils = {
	// ─── MATH HELPERS ───

	// In Utils.js
	/**
	 * Computes the pixel width of one data interval (the smallest gap
	 * between adjacent samples) using the given x-scale. Returns
	 * `minWidth` when the data is empty, single-sample, or the gap
	 * can't be measured.
	 */
	sampledIntervalPixelWidth : (data, xAccessor, xScale, sampleLimit = 100) => {
		const len = data.length;
		if (len === 0) return null;

		if (len === 1) return null;

		const sampleCount = len - 1 < sampleLimit ? len - 1 : sampleLimit;
		let minGap = Infinity;

		for (let i = 0; i < sampleCount; i++) {
			const xa = xAccessor(data[i]);
			const xb = xAccessor(data[i + 1]);
			if (!isFinite(xa) || !isFinite(xb)) continue;
			const gap = xb > xa ? xb - xa : xa - xb;
			if (gap > 0 && gap < minGap) minGap = gap;
		}

		if (!isFinite(minGap) || minGap <= 0) return null;

		const x0 = xScale.toScreen(0);
		const x1 = xScale.toScreen(minGap);
		return x1 > x0 ? x1 - x0 : x0 - x1;
	},

	/**
	 * Finds the sample in `data` whose x (under `xAccessor`) is closest to
	 * `targetX`. Linear scan, O(n). Assumes nothing about ordering.
	 *
	 * @param {Array<object>} data
	 * @param {Function} xAccessor
	 * @param {number} targetX
	 * @returns {{ sample: object, index: number, x: number, distance: number }|null}
	 *          Null if data is empty or no valid x was found.
	 */
	findNearestByX: (data, xAccessor, targetX) => {
		const len = data.length;
		if (len === 0) return null;

		// Fast path: if the data is sorted by x, binary search.
		// Assumption: data[i].x <= data[i+1].x under xAccessor.
		// Spot-check the assumption; fall back to linear if it fails.
		if (len >= 2) {
			const firstX = xAccessor(data[0]);
			const lastX = xAccessor(data[len - 1]);
			if (isFinite(firstX) && isFinite(lastX) && firstX <= lastX) {
				// Binary search for insertion point.
				let lo = 0, hi = len - 1;
				while (lo < hi) {
					const mid = (lo + hi) >>> 1;
					const mx = xAccessor(data[mid]);
					if (mx < targetX) lo = mid + 1;
					else hi = mid;
				}
				// lo is the first index with x >= targetX.
				// Compare data[lo-1] and data[lo].
				const iA = lo > 0 ? lo - 1 : 0;
				const iB = lo;
				const xA = xAccessor(data[iA]);
				const xB = xAccessor(data[iB]);
				const dA = _abs(xA - targetX);
				const dB = _abs(xB - targetX);
				const bestIndex = dA <= dB ? iA : iB;
				const bestX = bestIndex === iA ? xA : xB;
				const bestDistance = bestIndex === iA ? dA : dB;
				return { sample: data[bestIndex], index: bestIndex, x: bestX, distance: bestDistance };
			}
		}

		// Fallback: linear scan.
		let bestIndex = -1;
		let bestX = 0;
		let bestDistance = Infinity;

		for (let i = 0; i < len; i++) {
			const x = xAccessor(data[i]);
			if (!isFinite(x)) continue;
			const d = _abs(x - targetX);
			if (d < bestDistance) {
				bestDistance = d;
				bestX = x;
				bestIndex = i;
			}
		}

		if (bestIndex === -1) return null;
		return { sample: data[bestIndex], index: bestIndex, x: bestX, distance: bestDistance };
	},

	/**
	 * Clamp a value between min and max
	 */
	clamp: (value, min, max) => _max(min, _min(max, value)),

	/**
	 * Linear interpolation
	 */
	lerp: (a, b, t) => a + (b - a) * t,

	/**
	 * Calculate statistics from array of numbers
	 */
	calculateStats: (data) => {
		const len = data.length;
		if (len === 0) {
			return { min: 0, max: 1, range: 1, mean: 0, variance: 0, std: 0 };
		}

		let min = Infinity;
		let max = -Infinity;
		let sum = 0;

		for (let i = 0; i < len; i++) {
			const v = data[i];
			if (v < min) min = v;
			if (v > max) max = v;
			sum += v;
		}

		const mean = sum / len;
		let variance = 0;
		for (let i = 0; i < len; i++) {
			const diff = data[i] - mean;
			variance += diff * diff;
		}
		variance /= len;
		const std = _sqrt(variance);

		const range = max - min;
		if (range === 0) {
			const padding = _abs(max) * 0.1 || 1;
			return { min: min - padding, max: max + padding, range: padding * 2, mean, variance, std };
		}
		return { min, max, range, mean, variance, std };
	},

	/**
	 * Calculate rolling standard deviation
	 */
	rollingStd: (data, windowSize = 10) => {
		const len = data.length;
		if (len < 2) return 0;

		const slice = data.slice(-windowSize);
		const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
		const squaredDiffs = slice.map(v => _pow(v - mean, 2));
		const variance = squaredDiffs.reduce((a, b) => a + b, 0) / slice.length;
		return _sqrt(variance);
	},

	// ─── SCALE HELPERS ───

	/**
	 * Map value from data space to screen space (SVG Y-down)
	 */
	mapToScreen: (value, dataMin, dataMax, screenMin, screenMax) => {
		const dataRange = dataMax - dataMin || 1;
		return screenMin + ((value - dataMin) / dataRange) * (screenMax - screenMin);
	},

	/**
	 * Map value from screen space to data space
	 */
	mapToData: (screenValue, dataMin, dataMax, screenMin, screenMax) => {
		const screenRange = screenMax - screenMin || 1;
		return dataMin + ((screenValue - screenMin) / screenRange) * (dataMax - dataMin);
	},

	/**
	 * Get nice step for ticks
	 */
	niceStep: (step) => {
		const exponent = _floor(Math.log10(_abs(step)));
		const fraction = step / _pow(10, exponent);
		let niceFraction;
		if (fraction < 1.5) niceFraction = 1;
		else if (fraction < 3) niceFraction = 2;
		else if (fraction < 7) niceFraction = 5;
		else niceFraction = 10;
		return niceFraction * _pow(10, exponent);
	},

	/**
	 * Generate nice ticks for a range
	 */
	niceTicks: (dataMin, dataMax, count = 10) => {
		const dataRange = dataMax - dataMin || 1;
		let step = dataRange / count;
		step = Utils.niceStep(step);

		const start = _ceil(dataMin / step) * step;
		const ticks = [];
		let tick = start;
		while (tick <= dataMax + step * 0.01) {
			ticks.push(_round(tick / step) * step);
			tick += step;
		}

		// Remove duplicates
		const unique = [];
		for (let i = 0; i < ticks.length; i++) {
			if (i === 0 || ticks[i] !== ticks[i - 1]) {
				unique.push(ticks[i]);
			}
		}
		return unique;
	},

	// ─── DATA PROCESSING ───

	/**
	 * Batch process data points with accessors
	 */
	processDataBatch: (data, accessors) => {
		const { yAccessor, xAccessor, timestampAccessor } = accessors;
		const len = data.length;
		const results = new Array(len);
		const yValues = new Array(len);

		for (let i = 0; i < len; i++) {
			const point = data[i];
			const x = xAccessor(point);
			const y = yAccessor(point);
			const timestamp = timestampAccessor ? timestampAccessor(point) : x;
			results[i] = { ...point, x, y, timestamp };
			yValues[i] = y;
		}

		return { points: results, yValues };
	},

	/**
	 * Downsample data using Largest Triangle Three Buckets (LTTB)
	 */
	downsample: (data, targetCount = 2000) => {
		const len = data.length;
		if (len <= targetCount) return data;

		const step = len / targetCount;
		const result = [];

		// Always include first and last points
		result.push(data[0]);

		// Sample evenly
		for (let i = 1; i < len - 1; i += step) {
			const idx = _floor(i);
			result.push(data[idx]);
		}

		result.push(data[len - 1]);
		return result;
	},

	/**
	 * Trim points older than cutoff
	 */
	trimByTime: (data, accessor, cutoff) => {
		// Binary search or linear scan
		const result = [];
		for (let i = 0; i < data.length; i++) {
			if (accessor(data[i]) >= cutoff) {
				result.push(data[i]);
			}
		}
		return result;
	},

	/**
	 * Limit points to max count (keep newest)
	 */
	limitPoints: (points, maxCount) => {
		if (maxCount === Infinity || maxCount <= 0 || points.length <= maxCount) {
			return points;
		}
		const start = points.length - maxCount;
		const limited = new Array(maxCount);
		for (let i = 0; i < maxCount; i++) {
			limited[i] = points[start + i];
		}
		return limited;
	},

	/**
	 * Find min/max of data using accessors
	 */
	findExtremes: (data, xAccessor, yAccessor) => {
		const len = data.length;
		if (len === 0) {
			return { xMin: Infinity, xMax: -Infinity, yMin: Infinity, yMax: -Infinity, hasData: false };
		}

		let xMin = Infinity, xMax = -Infinity;
		let yMin = Infinity, yMax = -Infinity;

		for (let i = 0; i < len; i++) {
			const d = data[i];
			const x = xAccessor(d);
			const y = yAccessor(d);
			if (x < xMin) xMin = x;
			if (x > xMax) xMax = x;
			if (y < yMin) yMin = y;
			if (y > yMax) yMax = y;
		}

		return { xMin, xMax, yMin, yMax, hasData: true };
	},

	// ─── DOM HELPERS ───

	/**
	 * Debounce function for rate limiting
	 */
	debounce: (fn, delay) => {
		let timer = null;
		return function (...args) {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				fn.apply(this, args);
				timer = null;
			}, delay);
		};
	},

	/**
	 * Throttle function for rate limiting
	 */
	throttle: (fn, limit) => {
		let inThrottle = false;
		let lastResult = null;

		return function (...args) {
			if (!inThrottle) {
				lastResult = fn.apply(this, args);
				inThrottle = true;
				setTimeout(() => {
					inThrottle = false;
				}, limit);
			}
			return lastResult;
		};
	},

	/**
	 * RAF-based batch updater
	 */
	createBatchUpdater: () => {
		let pending = false;
		let rafId = null;
		let callbacks = [];

		const process = () => {
			rafId = null;
			pending = false;
			const cbs = callbacks;
			callbacks = [];
			for (let i = 0, len = cbs.length; i < len; i++) {
				cbs[i]();
			}
		};

		return {
			schedule: (callback) => {
				callbacks.push(callback);
				if (!pending) {
					pending = true;
					if (rafId) cancelAnimationFrame(rafId);
					rafId = requestAnimationFrame(process);
				}
			},
			cancel: () => {
				if (rafId) {
					cancelAnimationFrame(rafId);
					rafId = null;
				}
				pending = false;
				callbacks = [];
			}
		};
	},

	// ─── ID GENERATION ───
	uniqueId: (() => {
		let counter = 0;
		return (prefix = 'id') => `${prefix}-${counter++}`;
	})(),

	// ─── ARRAY HELPERS ───

	/**
	 * Check if two arrays are equal
	 */
	arraysEqual: (a, b) => {
		if (a === b) return true;
		if (a.length !== b.length) return false;
		for (let i = 0, len = a.length; i < len; i++) {
			if (a[i] !== b[i]) return false;
		}
		return true;
	},

	/**
	 * Fast array slice (avoids creating new array if not needed)
	 */
	fastSlice: (arr, start, end) => {
		const len = arr.length;
		if (start === 0 && end === len) return arr;
		const slice = new Array(end - start);
		for (let i = start; i < end; i++) {
			slice[i - start] = arr[i];
		}
		return slice;
	}
};

export default Utils;