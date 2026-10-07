// ──────────────────────────────────────────────────────────────
// ChartSelection.js
//
// Selection domain for data layers (charts, candles, etc.) on a plane.
// Recognizes clicks on a layer's DOM group via the `__cpLayerId` tag,
// applies sel-chart-* state classes to each data layer's group.
//
// Self-wiring:
//   - Subscribes to LAYER_REMOVED to drop stale ids.
//   - Subscribes to LAYER_ADDED to invalidate the cached layer list.
//   - Subscribes to PLANE_UPDATED to re-apply initial state to newly
//     added layers, whose groups don't exist until they render.
// ──────────────────────────────────────────────────────────────

import { Selection } from './Selection.js';
import { Events } from '../core/Events.js';
import { CSS } from '../core/CSS.js';

const css = CSS.selection;

export class ChartSelection extends Selection {
	/**
	 * @param {object} options
	 * @param {CartesianPlane} options.plane
	 */
	constructor(options = {}) {
		const plane = options.plane || null;

		super({
			element: plane && typeof plane.getHitElement === 'function'
				? plane.getHitElement()
				: null
		});

		this._plane = plane;
		this._extraUnsubs = [];
		this._cachedLayers = null;

		// Cache class names once.
		this._classNames = {
			normal: css.chartNormal,
			selected: css.chartSelected,
			unselected: css.chartUnselected
		};

		if (this._plane && this._plane.events) {
			const events = this._plane.events;

			this._extraUnsubs.push(
				events.on(Events.LAYER_REMOVED, ({ id }) => {
					this._cachedLayers = null;
					this.forget(id);
				})
			);

			this._extraUnsubs.push(
				events.on(Events.LAYER_ADDED, () => {
					this._cachedLayers = null;
				})
			);

			this._extraUnsubs.push(
				events.on(Events.PLANE_UPDATED, () => {
					this.reapplyClasses();
				})
			);
		}
	}

	// ──────────────────────────────────────────────────────────
	// DOMAIN INTERFACE
	// ──────────────────────────────────────────────────────────

	/**
	 * Walks up from the clicked DOM element to find a data-layer group.
	 *
	 * @param {Element} domElement
	 * @returns {object|null}
	 */
	resolve(domElement) {
		const plane = this._plane;
		if (!plane) return null;

		const root = this._element;
		let node = domElement;

		while (node && node !== root) {
			const id = node.__cpLayerId;
			if (id) {
				const layer = plane.getLayer(id);
				return layer && layer.isDataLayer ? layer : null;
			}
			node = node.parentNode;
		}
		return null;
	}

	/**
	 * Returns the cached list of data layers. Invalidated on
	 * LAYER_ADDED / LAYER_REMOVED.
	 *
	 * @returns {object[]}
	 */
	getAll() {
		if (this._cachedLayers !== null) return this._cachedLayers;
		if (!this._plane) return [];

		const layers = this._plane.getLayers();
		const result = [];
		for (let i = 0, len = layers.length; i < len; i++) {
			const l = layers[i];
			if (l.isDataLayer) result.push(l);
		}
		this._cachedLayers = result;
		return result;
	}

	targetOf(layer) {
		return layer._elements && layer._elements.group;
	}

	idOf(layer) {
		return layer.id;
	}

	getClassNames() {
		return this._classNames;
	}

	// ──────────────────────────────────────────────────────────
	// LIFECYCLE
	// ──────────────────────────────────────────────────────────

	destroy() {
		for (const unsub of this._extraUnsubs) {
			try { unsub(); } catch (e) { /* ignore */ }
		}
		this._extraUnsubs = [];
		this._cachedLayers = null;
		this._plane = null;
		super.destroy();
	}
}

export default ChartSelection;