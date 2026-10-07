// ──────────────────────────────────────────────────────────────
// XAxis.js
// ──────────────────────────────────────────────────────────────

import { SVG } from '../core/SVG.js';
import { CSS } from '../core/CSS.js';
import {
	Axis,
	TICK_LENGTH_MAJOR,
	TICK_LENGTH_MINOR,
	TICK_LENGTH_MICRO
} from './Axis.js';

const css = CSS.axis;

const LABEL_PADDING_FROM_TICK_END = 1;

export class XAxis extends Axis {
	constructor(options = {}) {
		super({
			...options,
			orientation: options.orientation || 'bottom'
		});

		// Default XAxis label alignment is 'left'.
		if (options.tickLabelAlign === undefined) {
			this.tickLabelAlign = 'left';
		}

		// Precompute label placement.
		switch (this.tickLabelAlign) {
			case 'left':
				this._textAnchor = 'start';
				this._xOffset = this.tickLabelPadding;
				break;
			case 'right':
				this._textAnchor = 'end';
				this._xOffset = -this.tickLabelPadding;
				break;
			default:
				this._textAnchor = 'middle';
				this._xOffset = 0;
				break;
		}
	}

	// ─── Lengths ───
	_getMajorTickLength() {
		if (this.tickSize !== null) return this.tickSize;
		if (this.tickLabelAlign === 'centered') return TICK_LENGTH_MAJOR;
		return TICK_LENGTH_MINOR + this.fontSize;
	}

	_getMinorTickLength() {
		if (this.minorTickSize !== null) return this.minorTickSize;
		if (this.tickLabelAlign === 'centered') return TICK_LENGTH_MINOR;
		return TICK_LENGTH_MICRO + this.fontSize;
	}

	_getMicroTickLength() {
		if (this.microTickSize !== null) return this.microTickSize;
		return TICK_LENGTH_MICRO;
	}

	// ─── Label placement ───
	_getTickLabelY(axisPosition, majorTickLength, tickDirection) {
		const tickEnd = axisPosition + majorTickLength * tickDirection;
		if (this.tickLabelAlign === 'centered') {
			return tickEnd + LABEL_PADDING_FROM_TICK_END * tickDirection;
		}
		return tickEnd;
	}

	_getTickLabelBaseline(side) {
		if (this.tickLabelAlign === 'centered') {
			return side === 'top' ? 'baseline' : 'hanging';
		}
		return 'baseline';
	}

	// ─── Dispatch ───
	_renderAxisOrientation() {
		if (this.orientation === 'top') this._renderTop();
		else this._renderBottom();
	}

	// ─── Render: bottom ───
	_renderBottom() {
		const scale = this.scale;
		const plane = this.plane;
		const el = this._elements;
		const group = el.group;

		const r0 = scale.range[0];
		const r1 = scale.range[1];
		const left = r0 < r1 ? r0 : r1;
		const right = r0 < r1 ? r1 : r0;
		const position = plane.plotBottom;
		const tickDirection = this.positionIntent === 'inside' ? -1 : 1;

		const majorTickLength = this._getMajorTickLength();
		const minorTickLength = this._getMinorTickLength();
		const microTickLength = this._getMicroTickLength();

		const axisLine = el.axisLine;
		axisLine.setAttribute('x1', left);
		axisLine.setAttribute('y1', position);
		axisLine.setAttribute('x2', right);
		axisLine.setAttribute('y2', position);

		const tiers = this._getTickTiers();
		const majorTicks = tiers.majorTicks;
		const minorTicks = tiers.minorTicks;
		const microTicks = tiers.microTicks;
		const decimals = tiers.decimals;
		const majorCount = majorTicks.length;
		const minorCount = minorTicks.length;
		const microCount = microTicks.length;

		const showTicks = this.showTicks;
		const showLabels = this.showTickLabels;
		const showGrid = this.showGrid;
		const showMinor = this.showMinorTicks;
		const showMicro = this.showMicroTicks;

		if (showTicks) {
			this._growPool(el.tickLines, majorCount, () => SVG.create('line', {
				class: css.tickLine
			}), group);
		}
		if (showLabels) {
			const labelClass = this._tickLabelClass;
			this._growPool(el.tickLabels, majorCount, () => SVG.create('text', {
				class: labelClass
			}), group);
		}
		if (showGrid) {
			this._growPool(el.gridLines, majorCount, () => SVG.create('line', {
				class: css.gridLine
			}), group);
		}
		if (showMinor) {
			this._growPool(el.minorTickLines, minorCount, () => SVG.create('line', {
				class: css.minorTick
			}), group);
		}
		if (showMicro) {
			this._growPool(el.microTickLines, microCount, () => SVG.create('line', {
				class: css.microTick
			}), group);
		}

		const anchor = this._textAnchor;
		const baseline = this._getTickLabelBaseline('bottom');
		const labelY = this._getTickLabelY(position, majorTickLength, tickDirection);
		const xOffset = this._xOffset;
		const tickEndY = position + majorTickLength * tickDirection;
		const plotTop = plane.plotTop;

		const tickLines = el.tickLines;
		const tickLabels = el.tickLabels;
		const gridLines = el.gridLines;

		for (let i = 0; i < majorCount; i++) {
			const value = majorTicks[i];
			const x = scale.toScreen(value);
			if (!isFinite(x)) continue;

			if (showTicks) {
				const line = tickLines[i];
				line.setAttribute('visibility', 'visible');
				line.setAttribute('x1', x);
				line.setAttribute('y1', position);
				line.setAttribute('x2', x);
				line.setAttribute('y2', tickEndY);
			}

			if (showLabels) {
				const label = tickLabels[i];
				const text = this._formatTick(value, decimals);
				if (label.textContent !== text) label.textContent = text;
				label.setAttribute('visibility', 'visible');
				label.setAttribute('x', x + xOffset);
				label.setAttribute('y', labelY);
				label.setAttribute('text-anchor', anchor);
				label.setAttribute('dominant-baseline', baseline);
			}

			if (showGrid) {
				const grid = gridLines[i];
				grid.setAttribute('visibility', 'visible');
				grid.setAttribute('x1', x);
				grid.setAttribute('y1', position);
				grid.setAttribute('x2', x);
				grid.setAttribute('y2', plotTop);
			}
		}

		if (showTicks) this._hidePoolFrom(tickLines, majorCount);
		if (showLabels) this._hidePoolFrom(tickLabels, majorCount);
		if (showGrid) this._hidePoolFrom(gridLines, majorCount);

		if (showMinor && minorCount > 0) {
			const lines = el.minorTickLines;
			const endY = position + minorTickLength * tickDirection;
			for (let i = 0; i < minorCount; i++) {
				const x = scale.toScreen(minorTicks[i]);
				if (!isFinite(x)) continue;
				const line = lines[i];
				line.setAttribute('visibility', 'visible');
				line.setAttribute('x1', x);
				line.setAttribute('y1', position);
				line.setAttribute('x2', x);
				line.setAttribute('y2', endY);
			}
			this._hidePoolFrom(lines, minorCount);
		} else if (el.minorTickLines.length > 0) {
			this._hidePoolFrom(el.minorTickLines, 0);
		}

		if (showMicro && microCount > 0) {
			const lines = el.microTickLines;
			const endY = position + microTickLength * tickDirection;
			for (let i = 0; i < microCount; i++) {
				const x = scale.toScreen(microTicks[i]);
				if (!isFinite(x)) continue;
				const line = lines[i];
				line.setAttribute('visibility', 'visible');
				line.setAttribute('x1', x);
				line.setAttribute('y1', position);
				line.setAttribute('x2', x);
				line.setAttribute('y2', endY);
			}
			this._hidePoolFrom(lines, microCount);
		} else if (el.microTickLines.length > 0) {
			this._hidePoolFrom(el.microTickLines, 0);
		}

		const labelEl = el.label;
		if (labelEl && this.showLabel && this.label) {
			const totalOffset = majorTickLength + this.fontSize + 6 + this.labelOffset;
			labelEl.setAttribute('x', (left + right) / 2);
			labelEl.setAttribute('y', position + totalOffset * tickDirection);
		}
	}

	// ─── Render: top ───
	_renderTop() {
		const scale = this.scale;
		const plane = this.plane;
		const el = this._elements;
		const group = el.group;

		const r0 = scale.range[0];
		const r1 = scale.range[1];
		const left = r0 < r1 ? r0 : r1;
		const right = r0 < r1 ? r1 : r0;
		const position = plane.plotTop;
		const tickDirection = this.positionIntent === 'inside' ? 1 : -1;

		const majorTickLength = this._getMajorTickLength();
		const minorTickLength = this._getMinorTickLength();
		const microTickLength = this._getMicroTickLength();

		const axisLine = el.axisLine;
		axisLine.setAttribute('x1', left);
		axisLine.setAttribute('y1', position);
		axisLine.setAttribute('x2', right);
		axisLine.setAttribute('y2', position);

		const tiers = this._getTickTiers();
		const majorTicks = tiers.majorTicks;
		const minorTicks = tiers.minorTicks;
		const microTicks = tiers.microTicks;
		const decimals = tiers.decimals;
		const majorCount = majorTicks.length;
		const minorCount = minorTicks.length;
		const microCount = microTicks.length;

		const showTicks = this.showTicks;
		const showLabels = this.showTickLabels;
		const showGrid = this.showGrid;
		const showMinor = this.showMinorTicks;
		const showMicro = this.showMicroTicks;

		if (showTicks) {
			this._growPool(el.tickLines, majorCount, () => SVG.create('line', {
				class: css.tickLine
			}), group);
		}
		if (showLabels) {
			const labelClass = this._tickLabelClass;
			this._growPool(el.tickLabels, majorCount, () => SVG.create('text', {
				class: labelClass
			}), group);
		}
		if (showGrid) {
			this._growPool(el.gridLines, majorCount, () => SVG.create('line', {
				class: css.gridLine
			}), group);
		}
		if (showMinor) {
			this._growPool(el.minorTickLines, minorCount, () => SVG.create('line', {
				class: css.minorTick
			}), group);
		}
		if (showMicro) {
			this._growPool(el.microTickLines, microCount, () => SVG.create('line', {
				class: css.microTick
			}), group);
		}

		const anchor = this._textAnchor;
		const baseline = this._getTickLabelBaseline('top');
		const labelY = this._getTickLabelY(position, majorTickLength, tickDirection);
		const xOffset = this._xOffset;
		const tickEndY = position + majorTickLength * tickDirection;
		const plotBottom = plane.plotBottom;

		const tickLines = el.tickLines;
		const tickLabels = el.tickLabels;
		const gridLines = el.gridLines;

		for (let i = 0; i < majorCount; i++) {
			const value = majorTicks[i];
			const x = scale.toScreen(value);
			if (!isFinite(x)) continue;

			if (showTicks) {
				const line = tickLines[i];
				line.setAttribute('visibility', 'visible');
				line.setAttribute('x1', x);
				line.setAttribute('y1', position);
				line.setAttribute('x2', x);
				line.setAttribute('y2', tickEndY);
			}

			if (showLabels) {
				const label = tickLabels[i];
				const text = this._formatTick(value, decimals);
				if (label.textContent !== text) label.textContent = text;
				label.setAttribute('visibility', 'visible');
				label.setAttribute('x', x + xOffset);
				label.setAttribute('y', labelY);
				label.setAttribute('text-anchor', anchor);
				label.setAttribute('dominant-baseline', baseline);
			}

			if (showGrid) {
				const grid = gridLines[i];
				grid.setAttribute('visibility', 'visible');
				grid.setAttribute('x1', x);
				grid.setAttribute('y1', position);
				grid.setAttribute('x2', x);
				grid.setAttribute('y2', plotBottom);
			}
		}

		if (showTicks) this._hidePoolFrom(tickLines, majorCount);
		if (showLabels) this._hidePoolFrom(tickLabels, majorCount);
		if (showGrid) this._hidePoolFrom(gridLines, majorCount);

		if (showMinor && minorCount > 0) {
			const lines = el.minorTickLines;
			const endY = position + minorTickLength * tickDirection;
			for (let i = 0; i < minorCount; i++) {
				const x = scale.toScreen(minorTicks[i]);
				if (!isFinite(x)) continue;
				const line = lines[i];
				line.setAttribute('visibility', 'visible');
				line.setAttribute('x1', x);
				line.setAttribute('y1', position);
				line.setAttribute('x2', x);
				line.setAttribute('y2', endY);
			}
			this._hidePoolFrom(lines, minorCount);
		} else if (el.minorTickLines.length > 0) {
			this._hidePoolFrom(el.minorTickLines, 0);
		}

		if (showMicro && microCount > 0) {
			const lines = el.microTickLines;
			const endY = position + microTickLength * tickDirection;
			for (let i = 0; i < microCount; i++) {
				const x = scale.toScreen(microTicks[i]);
				if (!isFinite(x)) continue;
				const line = lines[i];
				line.setAttribute('visibility', 'visible');
				line.setAttribute('x1', x);
				line.setAttribute('y1', position);
				line.setAttribute('x2', x);
				line.setAttribute('y2', endY);
			}
			this._hidePoolFrom(lines, microCount);
		} else if (el.microTickLines.length > 0) {
			this._hidePoolFrom(el.microTickLines, 0);
		}

		const labelEl = el.label;
		if (labelEl && this.showLabel && this.label) {
			const totalOffset = majorTickLength + this.fontSize + 6 + this.labelOffset;
			labelEl.setAttribute('x', (left + right) / 2);
			labelEl.setAttribute('y', position + totalOffset * tickDirection);
		}
	}
}

export default XAxis;