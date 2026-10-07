// ──────────────────────────────────────────────────────────────
// Layer.js - Base class for all layers
// ──────────────────────────────────────────────────────────────

import { Utils } from './Utils.js';

export class Layer {
	constructor(options = {}) {
		// ─── SLOT ───
		// Where this layer renders in the plane's DOM tree. Subclasses
		// override with their preferred slot:
		//   'plot-area' | 'band' | 'grid' | 'annotations' | 'overlay' | 'margin'
		this.slot = options.slot || 'plot-area';

		// ─── IDENTITY ───
		this.id = options.id || Utils.uniqueId('layer-');
		this.type = options.type || 'layer';
		this.name = options.name || 'Layer';
		this.label = options.label || options.name || this.name;

		// ─── Z-ORDER ───
		// Numeric z within the layer's slot. Higher renders on top.
		// Ties resolve by insertion order. See CartesianPlane._computeRenderOrder.
		this.z = options.z !== undefined ? options.z : 0;

		// ─── PARENT ───
		this.plane = options.plane || null;

		// ─── STATE ───
		this._dirty = true;
		this._updateCount = 0;
		this._destroyed = false;

		// ─── CALLBACKS ───
		this.onUpdate = options.onUpdate || null;
		this.onDestroy = options.onDestroy || null;

		// ─── CAPABILITIES (overridden by subclasses) ───
		this.isDataLayer = false;
		this.needsMargin = false;
		this.needsRender = true;
		this.needsUpdate = true;
	}

	// ──────────────────────────────────────────────────────────
	// LIFECYCLE
	// ──────────────────────────────────────────────────────────

	/**
	 * Renders the layer into the given container. Override in subclasses
	 * that create DOM.
	 *
	 * @param {SVGElement} container
	 * @returns {SVGElement|null}
	 */
	render(container) {
		return null;
	}

	/**
	 * Called by the plane on every render pass. Override in subclasses
	 * that need to react to state changes.
	 *
	 * @returns {Layer} this
	 */
	update() {
		this._updateCount++;
		return this;
	}

	/**
	 * Permanently tears down the layer. Called by the plane only during
	 * clearLayers() / destroy(); not called by removeLayer().
	 *
	 * After destroy(), the layer instance cannot be re-attached.
	 */
	destroy() {
		if (this._destroyed) return;
		this._destroyed = true;
		this.plane = null;
		if (this.onDestroy) this.onDestroy(this);
	}

	// ──────────────────────────────────────────────────────────
	// CAPABILITIES (subclass overrides)
	// ──────────────────────────────────────────────────────────

	/**
	 * Returns this layer's margin request for the current pass, or null
	 * if it contributes no margin. Overridden by axes and outside-positioned
	 * chrome.
	 *
	 * @returns {{ top?: number, bottom?: number, left?: number, right?: number }|null}
	 */
	getMarginRequest() {
		return null;
	}

	/**
	 * Returns this layer's data-domain contribution, or null. Overridden
	 * by data layers.
	 *
	 * @returns {object|null}
	 */
	getStats() {
		return null;
	}

	/**
	 * Returns the layer's primary theme color as a resolved CSS color
	 * string, or null if the layer doesn't define one.
	 *
	 * Default implementation reads a `--color` custom property from the
	 * layer's group. Subclasses override to pick their own variable.
	 *
	 * @returns {string|null}
	 */
	getColor() {
		const group = this._elements && this._elements.group;
		if (!group) return null;
		const v = getComputedStyle(group).getPropertyValue('--color').trim();
		return v || null;
	}

	/**
	 * Called by the plane's removeLayer to give the layer a chance to
	 * unsubscribe from plane events and release anything it wired up
	 * during attach. Overridden by layers that subscribe.
	 *
	 * No-op by default.
	 */
	_unsubscribeFromPlaneEvents() {
		// Override in subclasses that subscribe to plane events.
	}

	// ──────────────────────────────────────────────────────────
	// DISPLAY
	// ──────────────────────────────────────────────────────────

	/**
	 * @returns {string} A human-readable label for this layer
	 */
	getDisplayLabel() {
		return this.label || this.name || this.type || 'Unknown';
	}

	/**
	 * @returns {{ updateCount: number, destroyed: boolean }}
	 */
	getPerformance() {
		return {
			updateCount: this._updateCount,
			destroyed: this._destroyed
		};
	}
}

export default Layer;