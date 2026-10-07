// ──────────────────────────────────────────────────────────────
// SVG.js - SVG Helpers
// ──────────────────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

export const SVG = {
	/**
	 * Create an SVG element with attributes
	 * @param {string} name - Element name
	 * @param {Object} attrs - Attributes to set
	 * @returns {SVGElement}
	 */
	create: (name, attrs = {}) => {
		const el = document.createElementNS(SVG_NS, name);
		const entries = Object.entries(attrs);
		for (let i = 0; i < entries.length; i++) {
			const [key, value] = entries[i];
			if (value !== undefined && value !== null) {
				el.setAttribute(key, value);
			}
		}
		return el;
	},

	/**
	 * Set attributes on an SVG element
	 * @param {SVGElement} el - Element to modify
	 * @param {Object} attrs - Attributes to set
	 * @returns {SVGElement}
	 */
	set: (el, attrs = {}) => {
		if (!el) return el;
		const entries = Object.entries(attrs);
		for (let i = 0; i < entries.length; i++) {
			const [key, value] = entries[i];
			if (value !== undefined && value !== null) {
				el.setAttribute(key, value);
			}
		}
		return el;
	},

	/**
	 * Append children to parent
	 * @param {SVGElement} parent - Parent element
	 * @param {...SVGElement} children - Children to append
	 * @returns {SVGElement}
	 */
	append: (parent, ...children) => {
		for (let i = 0; i < children.length; i++) {
			const child = children[i];
			if (child) parent.appendChild(child);
		}
		return parent;
	},

	/**
	 * Batch create elements with same structure
	 * @param {string} name - Element name
	 * @param {Array<Object>} attrsList - Array of attribute objects
	 * @returns {Array<SVGElement>}
	 */
	createBatch: (name, attrsList) => {
		const results = new Array(attrsList.length);
		for (let i = 0; i < attrsList.length; i++) {
			results[i] = SVG.create(name, attrsList[i]);
		}
		return results;
	},

	/**
	 * Remove all children from an element
	 * @param {SVGElement} parent - Parent element
	 * @returns {SVGElement}
	 */
	clear: (parent) => {
		while (parent.firstChild) {
			parent.removeChild(parent.firstChild);
		}
		return parent;
	},

	/**
	 * Get or create an element by ID
	 * @param {string} id - Element ID
	 * @param {SVGElement} container - Container to search in
	 * @param {string} tag - Tag name if creating
	 * @returns {SVGElement|null}
	 */
	getOrCreate: (id, container, tag = 'g') => {
		let el = container.querySelector(`#${id}`);
		if (!el) {
			el = SVG.create(tag, { id });
			SVG.append(container, el);
		}
		return el;
	},

	// ─── Coordinates ───
    /**
     * Converts a browser mouse event into SVG user-space coordinates
     * relative to the given SVG element's viewBox.
     *
     * Uses the SVG's current screen CTM to invert the browser's
     * client-space coordinates back into user-space, which is the
     * space every layer renders in. Works regardless of CSS
     * transforms, scroll, or SVG resizing.
     */
    getPoint(svg, evt) {
		if (!svg) return null;
		const pt = svg.createSVGPoint();
		pt.x = evt.clientX;
		pt.y = evt.clientY;
		const ctm = svg.getScreenCTM();
		if (!ctm) return null;
		return pt.matrixTransform(ctm.inverse());
	},

	/**
	 * Returns true if the given user-space point is inside the given
	 * rectangular bounds (inclusive on all edges).
	 */
	pointInBounds(pt, bounds) {
		if (!pt || !bounds) return false;
		return pt.x >= bounds.left && pt.x <= bounds.right &&
			pt.y >= bounds.top && pt.y <= bounds.bottom;
	}
};

export default SVG;