// ──────────────────────────────────────────────────────────────
// YAxis.js
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

export class YAxis extends Axis {
	constructor(options = {}) {
		super({
			...options,
			orientation: options.orientation || 'right'
		});
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

	_renderAxisOrientation() {
		if (this.orientation === 'left') this._renderLeft();
		else this._renderRight();
	}

	// ─── Render: right ───
	_renderRight() {
		const scale = this.scale;
		const plane = this.plane;
		const el = this._elements;
		const group = el.group;

		const bandBounds = this._getBandBounds();
		const yMin = bandBounds ? bandBounds.bottom : plane.plotBottom;
		const yMax = bandBounds ? bandBounds.top : plane.plotTop;

		const position = plane.plotRight;
		const tickDirection = this.positionIntent === 'inside' ? -1 : 1;
		const rotationAngle = this.positionIntent === 'inside' ? -90 : 90;

		const majorTickLength = this._getMajorTickLength();
		const minorTickLength = this._getMinorTickLength();
		const microTickLength = this._getMicroTickLength();

		const axisLine = el.axisLine;
		axisLine.setAttribute('x1', position);
		axisLine.setAttribute('y1', yMin);
		axisLine.setAttribute('x2', position);
		axisLine.setAttribute('y2', yMax);

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
			this._growPool(el.tickLabels, majorCount, () => SVG.create('text', {
				class: css.tickLabel
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

		const labelAnchor = this.positionIntent === 'inside' ? 'end' : 'start';
		const labelX = position + (majorTickLength + this.tickPadding) * tickDirection;
		const tickEndX = position + majorTickLength * tickDirection;
		const fontSize = this.fontSize;
		const plotLeft = plane.plotLeft;

		let maxLabelWidth = 0;

		const tickLines = el.tickLines;
		const tickLabels = el.tickLabels;
		const gridLines = el.gridLines;

		for (let i = 0; i < majorCount; i++) {
			const value = majorTicks[i];
			const y = scale.toScreen(value);
			if (!isFinite(y)) continue;

			if (showTicks) {
				const line = tickLines[i];
				line.setAttribute('visibility', 'visible');
				line.setAttribute('x1', position);
				line.setAttribute('y1', y);
				line.setAttribute('x2', tickEndX);
				line.setAttribute('y2', y);
			}

			if (showLabels) {
				const label = tickLabels[i];
				const text = this._formatTick(value, decimals);
				if (label.textContent !== text) label.textContent = text;
				label.setAttribute('visibility', 'visible');
				label.setAttribute('x', labelX);
				label.setAttribute('y', y);
				label.setAttribute('text-anchor', labelAnchor);
				label.setAttribute('dominant-baseline', 'middle');

				const w = text.length * (fontSize * 0.6) + 2;
				if (w > maxLabelWidth) maxLabelWidth = w;
			}

			if (showGrid) {
				const grid = gridLines[i];
				grid.setAttribute('visibility', 'visible');
				grid.setAttribute('x1', position);
				grid.setAttribute('y1', y);
				grid.setAttribute('x2', plotLeft);
				grid.setAttribute('y2', y);
			}
		}

		if (showTicks) this._hidePoolFrom(tickLines, majorCount);
		if (showLabels) this._hidePoolFrom(tickLabels, majorCount);
		if (showGrid) this._hidePoolFrom(gridLines, majorCount);

		if (showMinor && minorCount > 0) {
			const lines = el.minorTickLines;
			const endX = position + minorTickLength * tickDirection;
			for (let i = 0; i < minorCount; i++) {
				const y = scale.toScreen(minorTicks[i]);
				if (!isFinite(y)) continue;
				const line = lines[i];
				line.setAttribute('visibility', 'visible');
				line.setAttribute('x1', position);
				line.setAttribute('y1', y);
				line.setAttribute('x2', endX);
				line.setAttribute('y2', y);
			}
			this._hidePoolFrom(lines, minorCount);
		} else if (el.minorTickLines.length > 0) {
			this._hidePoolFrom(el.minorTickLines, 0);
		}

		if (showMicro && microCount > 0) {
			const lines = el.microTickLines;
			const endX = position + microTickLength * tickDirection;
			for (let i = 0; i < microCount; i++) {
				const y = scale.toScreen(microTicks[i]);
				if (!isFinite(y)) continue;
				const line = lines[i];
				line.setAttribute('visibility', 'visible');
				line.setAttribute('x1', position);
				line.setAttribute('y1', y);
				line.setAttribute('x2', endX);
				line.setAttribute('y2', y);
			}
			this._hidePoolFrom(lines, microCount);
		} else if (el.microTickLines.length > 0) {
			this._hidePoolFrom(el.microTickLines, 0);
		}

		const labelEl = el.label;
		if (labelEl && this.showLabel && this.label) {
			const labelY = (yMin + yMax) / 2;
			const totalOffset = majorTickLength + this.tickPadding +
				maxLabelWidth + this.tickPadding + this.labelOffset;
			const labelXAxis = position + totalOffset * tickDirection;
			labelEl.setAttribute('x', labelXAxis);
			labelEl.setAttribute('y', labelY);
			labelEl.setAttribute('transform',
				`rotate(${rotationAngle}, ${labelXAxis}, ${labelY})`);
		}
	}

	// ─── Render: left ───
	_renderLeft() {
		const scale = this.scale;
		const plane = this.plane;
		const el = this._elements;
		const group = el.group;

		const bandBounds = this._getBandBounds();
		const yMin = bandBounds ? bandBounds.bottom : plane.plotBottom;
		const yMax = bandBounds ? bandBounds.top : plane.plotTop;

		const position = plane.plotLeft;
		const tickDirection = this.positionIntent === 'inside' ? 1 : -1;
		const rotationAngle = this.positionIntent === 'inside' ? 90 : -90;

		const majorTickLength = this._getMajorTickLength();
		const minorTickLength = this._getMinorTickLength();
		const microTickLength = this._getMicroTickLength();

		const axisLine = el.axisLine;
		axisLine.setAttribute('x1', position);
		axisLine.setAttribute('y1', yMin);
		axisLine.setAttribute('x2', position);
		axisLine.setAttribute('y2', yMax);

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
			this._growPool(el.tickLabels, majorCount, () => SVG.create('text', {
				class: css.tickLabel
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

		const labelAnchor = this.positionIntent === 'inside' ? 'start' : 'end';
		const labelX = position + (majorTickLength + this.tickPadding) * tickDirection;
		const tickEndX = position + majorTickLength * tickDirection;
		const fontSize = this.fontSize;
		const plotRight = plane.plotRight;

		let maxLabelWidth = 0;

		const tickLines = el.tickLines;
		const tickLabels = el.tickLabels;
		const gridLines = el.gridLines;

		for (let i = 0; i < majorCount; i++) {
			const value = majorTicks[i];
			const y = scale.toScreen(value);
			if (!isFinite(y)) continue;

			if (showTicks) {
				const line = tickLines[i];
				line.setAttribute('visibility', 'visible');
				line.setAttribute('x1', position);
				line.setAttribute('y1', y);
				line.setAttribute('x2', tickEndX);
				line.setAttribute('y2', y);
			}

			if (showLabels) {
				const label = tickLabels[i];
				const text = this._formatTick(value, decimals);
				if (label.textContent !== text) label.textContent = text;
				label.setAttribute('visibility', 'visible');
				label.setAttribute('x', labelX);
				label.setAttribute('y', y);
				label.setAttribute('text-anchor', labelAnchor);
				label.setAttribute('dominant-baseline', 'middle');

				const w = text.length * (fontSize * 0.6) + 2;
				if (w > maxLabelWidth) maxLabelWidth = w;
			}

			if (showGrid) {
				const grid = gridLines[i];
				grid.setAttribute('visibility', 'visible');
				grid.setAttribute('x1', position);
				grid.setAttribute('y1', y);
				grid.setAttribute('x2', plotRight);
				grid.setAttribute('y2', y);
			}
		}

		if (showTicks) this._hidePoolFrom(tickLines, majorCount);
		if (showLabels) this._hidePoolFrom(tickLabels, majorCount);
		if (showGrid) this._hidePoolFrom(gridLines, majorCount);

		if (showMinor && minorCount > 0) {
			const lines = el.minorTickLines;
			const endX = position + minorTickLength * tickDirection;
			for (let i = 0; i < minorCount; i++) {
				const y = scale.toScreen(minorTicks[i]);
				if (!isFinite(y)) continue;
				const line = lines[i];
				line.setAttribute('visibility', 'visible');
				line.setAttribute('x1', position);
				line.setAttribute('y1', y);
				line.setAttribute('x2', endX);
				line.setAttribute('y2', y);
			}
			this._hidePoolFrom(lines, minorCount);
		} else if (el.minorTickLines.length > 0) {
			this._hidePoolFrom(el.minorTickLines, 0);
		}

		if (showMicro && microCount > 0) {
			const lines = el.microTickLines;
			const endX = position + microTickLength * tickDirection;
			for (let i = 0; i < microCount; i++) {
				const y = scale.toScreen(microTicks[i]);
				if (!isFinite(y)) continue;
				const line = lines[i];
				line.setAttribute('visibility', 'visible');
				line.setAttribute('x1', position);
				line.setAttribute('y1', y);
				line.setAttribute('x2', endX);
				line.setAttribute('y2', y);
			}
			this._hidePoolFrom(lines, microCount);
		} else if (el.microTickLines.length > 0) {
			this._hidePoolFrom(el.microTickLines, 0);
		}

		const labelEl = el.label;
		if (labelEl && this.showLabel && this.label) {
			const labelY = (yMin + yMax) / 2;
			const totalOffset = majorTickLength + this.tickPadding +
				maxLabelWidth + this.tickPadding + this.labelOffset;
			const labelXAxis = position + totalOffset * tickDirection;
			labelEl.setAttribute('x', labelXAxis);
			labelEl.setAttribute('y', labelY);
			labelEl.setAttribute('transform',
				`rotate(${rotationAngle}, ${labelXAxis}, ${labelY})`);
		}
	}
}

export default YAxis;