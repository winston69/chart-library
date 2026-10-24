// ──────────────────────────────────────────────────────────────
// indicators/Volume.js
//
// Volume rendering indicator. A class extending BaseIndicator.
//
// One layer:
//   bars   — BarChart, unsigned, colored by the candle direction,
//            primary (drives the y-axis)
//
// Volume values are expected on the input rows:
//   row.volume   — the sum of quantities for the bucket (unsigned)
//
// Direction comes from the row's open/close, not from the bar's
// own y-value. A bucket that closed up draws green even though
// its volume is positive; a bucket that closed down draws red
// for the same positive volume. That's the standard convention.
//
// There is no matching computer in the worker — volume is a raw
// field the workers already accumulate (`row.volume += quantity`
// in foldTrade). This class only renders.
//
// Usage:
//   const volume = new Volume({ plane });
//   volume.appendOrUpdate(row, keyFn);
//   volume.setData(rows);
//   volume.remove();
// ──────────────────────────────────────────────────────────────

import { BarChart } from '../layers/BarChart.js';
import { BaseIndicator } from './BaseIndicator.js';

const DEFAULT_Y_GROUP = 'volume-group';
const DEFAULT_HEIGHT = 0.20;
const DEFAULT_DECIMALS = 2;

export class Volume extends BaseIndicator {
	constructor(options = {}) {
		super({
			name: 'volume',
			yGroup: options.yGroup || DEFAULT_Y_GROUP,
			plane: options.plane
		});

		const {
			height = DEFAULT_HEIGHT,
			decimals = DEFAULT_DECIMALS,
			xAccessor = d => d.eventTime,
			yAccessor = d => d.volume,
			openAccessor = d => d.openPrice,
			closeAccessor = d => d.lastPrice,
			trimTail = false,
			idPrefix = 'volume'
		} = options;

		this.bars = this.addLayer(
			new BarChart({
				id: `${idPrefix}-bars`,
				name: 'Volume',
				decimals,
				data: [],
				xAccessor,
				yAccessor,
				openAccessor,
				closeAccessor,
				directionMode: 'ohlc',
				baseline: 'zero',
				barWidthFactor: 0.7,
				trimTail
			}),
			{ height, primary: true }
		);

		this.build();
	}
}

export default Volume;