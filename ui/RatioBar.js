import { formatNumber } from '../utils/Format.js';

const LEFT_COLOR = '#22c55e';
const RIGHT_COLOR = '#ef4444';
const VIEW_WIDTH = 100;
const VIEW_HEIGHT = 16;

function escapeXML(value) {
	return String(value).replace(/[&<>"']/g, character => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&apos;'
	})[character]);
}

function normalizeValue(value) {
	if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, value) : 0;
	if (typeof value === 'string') {
		const parsed = Number(value.replaceAll(',', ''));
		return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
	}
	return 0;
}

function valueLabel(value, normalizedValue) {
	if (typeof value === 'string') return value;
	return formatNumber(normalizedValue, Number.isInteger(normalizedValue) ? 0 : 2);
}

function labelFits(label, width) {
	return width >= label.length * 4.5 + 2;
}

export function RatioBar({
	leftValue,
	rightValue,
	leftColor = LEFT_COLOR,
	rightColor = RIGHT_COLOR
}) {
	const left = normalizeValue(leftValue);
	const right = normalizeValue(rightValue);
	const total = left + right;
	const leftWidth = total > 0 ? (left / total) * VIEW_WIDTH : VIEW_WIDTH / 2;
	const rightWidth = VIEW_WIDTH - leftWidth;
	const leftLabel = valueLabel(leftValue, left);
	const rightLabel = valueLabel(rightValue, right);
	const showLeftLabel = labelFits(leftLabel, leftWidth);
	const showRightLabel = labelFits(rightLabel, rightWidth);
	const leftText = showLeftLabel
		? `<text x="${leftWidth / 2}" y="11">${escapeXML(leftLabel)}</text>`
		: '';
	const rightText = showRightLabel
		? `<text x="${leftWidth + rightWidth / 2}" y="11">${escapeXML(rightLabel)}</text>`
		: '';

	return `<svg class="ratio-bar" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}" role="img" aria-label="Buy ${escapeXML(leftLabel)}, sell ${escapeXML(rightLabel)}"><rect class="ratio-bar-left" x="0" y="0" width="${leftWidth}" height="${VIEW_HEIGHT}" fill="${escapeXML(leftColor)}"/><rect class="ratio-bar-right" x="${leftWidth}" y="0" width="${rightWidth}" height="${VIEW_HEIGHT}" fill="${escapeXML(rightColor)}"/>${leftText}${rightText}</svg>`;
}

export default RatioBar;
