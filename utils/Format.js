const compactFormatter = new Intl.NumberFormat('en-US', {
	notation: 'compact',
	maximumSignificantDigits: 3
});

export function formatNumber(value, decimals = 2) {
	if (!Number.isFinite(value)) return String(value);

	const fractionDigits = Number.isInteger(decimals)
		? Math.min(100, Math.max(0, decimals))
		: 2;
	return new Intl.NumberFormat('en-US', {
		minimumFractionDigits: fractionDigits,
		maximumFractionDigits: fractionDigits
	}).format(value);
}

export function formatCompact(value) {
	if (!Number.isFinite(value)) return String(value);
	return compactFormatter.format(value);
}
