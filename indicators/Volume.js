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
// in foldTrade). This class also reports spikes against a rolling
// average of recent completed buckets through `onRowUpdate`.
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
const DEFAULT_AVERAGE_PERIOD = 20;
const VOLUME_SPIKE_MULTIPLIER = 3;

export function detectVolumeSpike(row, averageVolume, previousVolume = 0) {
	if (!row || !Number.isFinite(row.volume) || !Number.isFinite(averageVolume) || averageVolume <= 0) {
		return null;
	}
	const threshold = VOLUME_SPIKE_MULTIPLIER * averageVolume;
	if (row.volume <= threshold || previousVolume > threshold) return null;

	return {
		type: 'VOLUME_SPIKE',
		time: row.openTime,
		message: 'High volume spike detected.',
		severity: 'info'
	};
}

export class Volume extends BaseIndicator {
	constructor(options = {}) {
		super({
			name: 'volume',
			scaleType: options.scaleType || 'volume',
			yGroup: options.yGroup || DEFAULT_Y_GROUP,
			bandPosition: options.bandPosition || 'bottom',
			bandHeight: options.bandHeight !== undefined ? options.bandHeight : 0.15,
			axisOptions: {
				label: 'Volume',
				decimals: 0,
				...(options.axisOptions || {})
			},
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
			idPrefix = 'volume',
			onRowUpdate = null
		} = options;

		this.onRowUpdate = typeof onRowUpdate === 'function' ? onRowUpdate : null;

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

	appendOrUpdate(row, keyFn) {
		const data = this.primaryLayer && this.primaryLayer.data;
		const prevRow = data && data.length > 0 ? data[data.length - 1] : null;
		const sameBucket = prevRow && keyFn(prevRow) === keyFn(row);
		const historyEnd = data ? data.length - (sameBucket ? 1 : 0) : 0;
		const historyStart = Math.max(0, historyEnd - DEFAULT_AVERAGE_PERIOD);
		let totalVolume = 0;
		let volumeCount = 0;

		for (let i = historyStart; i < historyEnd; i++) {
			const volume = data[i].volume;
			if (!Number.isFinite(volume)) continue;
			totalVolume += volume;
			volumeCount++;
		}

		const averageVolume = volumeCount > 0 ? totalVolume / volumeCount : 0;
		const event = prevRow && this.onRowUpdate
			? detectVolumeSpike(row, averageVolume, sameBucket ? prevRow.volume : 0)
			: null;

		super.appendOrUpdate(row, keyFn);

		if (event) this.onRowUpdate(event);
	}
}

export default Volume;