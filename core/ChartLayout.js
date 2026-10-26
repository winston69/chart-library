export function calculateMargins(requests) {
	const margins = { top: 0, bottom: 0, left: 0, right: 0 };

	for (let i = 0; i < requests.length; i++) {
		const request = requests[i];
		if (!request) continue;
		if (request.top > margins.top) margins.top = request.top;
		if (request.bottom > margins.bottom) margins.bottom = request.bottom;
		if (request.left > margins.left) margins.left = request.left;
		if (request.right > margins.right) margins.right = request.right;
	}

	return margins;
}

export function calculatePlotArea(width, height, margins) {
	const left = margins.left;
	const right = width - margins.right;
	const top = margins.top;
	const bottom = height - margins.bottom;

	return {
		left, right, top, bottom,
		width: right - left,
		height: bottom - top
	};
}

export function calculateBandLayout({ width, height, margins, bands }) {
	const plot = calculatePlotArea(width, height, margins);
	const normalizedBands = bands.map(band => {
		let normalizedHeight = band.height;
		if (!isFinite(normalizedHeight) || normalizedHeight < 0) {
			normalizedHeight = band.flexible ? 0 : 0.3;
		}
		return { ...band, normalizedHeight };
	});
	const total = normalizedBands.reduce((sum, band) => sum + band.normalizedHeight, 0);
	const flexibleCount = normalizedBands.reduce((count, band) => count + (band.flexible ? 1 : 0), 0);
	const heightFractions = new Array(normalizedBands.length);

	if (flexibleCount > 0) {
		const fixedTotal = normalizedBands.reduce(
			(sum, band) => sum + (band.flexible ? 0 : band.normalizedHeight),
			0
		);
		if (fixedTotal > 1) {
			for (let i = 0; i < normalizedBands.length; i++) {
				const band = normalizedBands[i];
				heightFractions[i] = band.flexible
					? 0
					: band.normalizedHeight / fixedTotal;
			}
		} else {
			const flexibleFraction = (1 - fixedTotal) / flexibleCount;
			for (let i = 0; i < normalizedBands.length; i++) {
				const band = normalizedBands[i];
				heightFractions[i] = band.flexible
					? flexibleFraction
					: band.normalizedHeight;
			}
		}
	} else {
		for (let i = 0; i < normalizedBands.length; i++) {
			heightFractions[i] = total > 0
				? normalizedBands[i].normalizedHeight / total
				: 0;
		}
	}

	let bottom = plot.bottom;
	const layout = normalizedBands.map((band, index) => {
		const heightFraction = heightFractions[index];
		const bandHeight = plot.height * heightFraction;
		const top = bottom - bandHeight;
		const result = {
			...band,
			top,
			bottom,
			height: bandHeight,
			heightFraction,
			range: [bottom, top]
		};
		bottom = top;
		return result;
	});

	return { ...plot, bands: layout };
}
