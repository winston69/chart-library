// ──────────────────────────────────────────────────────────────
// indicators/BaseIndicator.js
//
// Base class for rendering indicator factories. Owns the layer
// list, the y-group, the primary layer, and the dispatch methods
// that forward append/update/setData calls to every owned layer.
//
// Main-thread only. Imports nothing worker-safe; the worker never
// touches this file. Computers live in `*.calc.js` files, which
// are pure math and are imported by the worker's registry.
//
// Subclass contract:
//
//   class Foo extends BaseIndicator {
//       constructor(options = {}) {
//           super({ name: 'foo', yGroup: 'foo-group', ...options });
//
//           const line = new Line({ ... });
//           this.line = line;
//           this.addLayer(line, { height: 0.3, primary: true });
//
//           this.build();
//       }
//   }
//
// The `primary: true` flag on an addLayer call designates the
// layer that consumers (the y-axis, the legend) should read from.
// If no layer is flagged, build() falls back to the first data
// layer in registration order.
//
// Consumers get:
//
//   indicator.layers         — Layer[] in registration order
//   indicator.group          — y-group id
//   indicator.primaryLayer   — the layer for the y-axis
//   indicator.appendPoint(row)
//   indicator.updateLastPoint(row)
//   indicator.appendOrUpdate(row, keyFn)
//   indicator.setData(rows)
//   indicator.remove()
//
// appendOrUpdate is the open-bucket entry point. It compares
// keyFn(lastRow) to keyFn(row); equal keys mean the bucket is
// still forming, so the last row is replaced in place. Different
// keys mean a new bucket, so the row is appended. Subclasses do
// not override this — it's uniform across every indicator.
// ──────────────────────────────────────────────────────────────

export class BaseIndicator {
	constructor(options = {}) {
		if (!options.plane) {
			throw new Error(`${this.constructor.name}: plane is required.`);
		}
		if (!options.name) {
			throw new Error(`${this.constructor.name}: name is required.`);
		}
		if (!options.yGroup) {
			throw new Error(`${this.constructor.name}: yGroup is required.`);
		}

		this.plane = options.plane;
		this.name = options.name;
		this.yGroup = options.yGroup;

		this.layers = [];
		this.primaryLayer = null;

		this._built = false;
	}

	// ──────────────────────────────────────────────────────────
	// SUBCLASS HOOKS
	// ──────────────────────────────────────────────────────────

	/**
	 * Register a layer with the plane and add it to this
	 * indicator's dispatch list.
	 *
	 * Options:
	 *   primary  — boolean. If true, this layer becomes the
	 *              primary layer (the one consumers read from
	 *              for the y-axis and legend). Only the first
	 *              flagged layer wins; later flags are ignored.
	 *   ...rest  — passed through to plane.addLayer
	 *              (typically { height }).
	 *
	 * Called from a subclass constructor. Do not call after
	 * build().
	 */
	addLayer(layer, options = {}) {
		if (this._built) {
			throw new Error(`${this.constructor.name}: addLayer after build().`);
		}

		const { primary, ...rest } = options;

		this.plane.addLayer(layer, {
			yGroup: this.yGroup,
			...rest
		});
		this.layers.push(layer);

		if (primary && this.primaryLayer === null) {
			this.primaryLayer = layer;
		}

		return layer;
	}

	/**
	 * Called at the end of a subclass constructor. Marks the
	 * indicator as complete and resolves the primary layer
	 * default if the subclass didn't flag one.
	 */
	build() {
		if (this._built) return this;
		if (!this.primaryLayer && this.layers.length > 0) {
			// First data layer wins.
			for (let i = 0; i < this.layers.length; i++) {
				if (this.layers[i].isDataLayer) {
					this.primaryLayer = this.layers[i];
					break;
				}
			}
			if (!this.primaryLayer) this.primaryLayer = this.layers[0];
		}
		this._built = true;
		return this;
	}

	// ──────────────────────────────────────────────────────────
	// DISPATCH
	// ──────────────────────────────────────────────────────────

	/**
	 * Append a new row to every owned layer. A new bucket has
	 * opened.
	 */
	appendPoint(row) {
		const layers = this.layers;
		for (let i = 0, len = layers.length; i < len; i++) {
			const layer = layers[i];
			if (typeof layer.appendPoint === 'function') {
				layer.appendPoint(row);
			}
		}
	}

	/**
	 * Replace the open (last) row in every owned layer. The
	 * current bucket ticked.
	 */
	updateLastPoint(row) {
		const layers = this.layers;
		for (let i = 0, len = layers.length; i < len; i++) {
			const layer = layers[i];
			if (typeof layer.updateLastPoint === 'function') {
				layer.updateLastPoint(row);
			}
		}
	}

	/**
	 * Append or replace-last depending on whether `row` belongs
	 * to the same bucket as the current tail. keyFn maps a row
	 * to a comparable bucket key.
	 */
	appendOrUpdate(row, keyFn) {
		const primary = this.primaryLayer;
		const data = primary && primary.data;
		const last = data && data.length > 0 ? data[data.length - 1] : null;

		if (last && keyFn(last) === keyFn(row)) {
			this.updateLastPoint(row);
		} else {
			this.appendPoint(row);
		}
	}

	/**
	 * Replace every owned layer's data. Used on seed.
	 */
	setData(rows) {
		const layers = this.layers;
		for (let i = 0, len = layers.length; i < len; i++) {
			const layer = layers[i];
			if (typeof layer.setData === 'function') {
				layer.setData(rows);
			}
		}
	}

	/**
	 * Detach every owned layer from the plane. Reverse order so
	 * z-order unwinds cleanly and dependent layers (fills,
	 * ghosts) are removed before their sources.
	 */
	remove() {
		for (let i = this.layers.length - 1; i >= 0; i--) {
			this.plane.removeLayer(this.layers[i]);
		}
		this.layers = [];
		this.primaryLayer = null;
	}
}

export default BaseIndicator;