// ──────────────────────────────────────────────────────────────
// Icons.js
//
// A registry of inline SVG icons. Each entry is an SVG string
// that uses `fill="currentColor"` and `stroke="currentColor"` so
// the rendered icon inherits the color of its container.
//
// Consumers call `Icons.create(spec)` to get a fresh DOM element.
// `spec` can be:
//   - a registered name:  'pan'
//   - an SVG string:      '<svg ...>...</svg>'
//   - a DOM element:      <svg>...</svg>  (returned unchanged)
//   - any other string:   '🖐️'  (returns a <span class="icon icon-text">)
//
// Never returns a shared node, so the same icon can be used in
// multiple places without collisions.
// ──────────────────────────────────────────────────────────────

const ICONS = {

	// ─── Interaction ───
	pan:
		'<svg viewBox="0 0 16 16" aria-hidden="true">' +
		'<path d="M8 1 L8 15 M1 8 L15 8 M5 3 L8 1 L11 3 M5 13 L8 15 L11 13 M3 5 L1 8 L3 11 M13 5 L15 8 L13 11" ' +
		'stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
		'</svg>',

	zoom:
		'<svg viewBox="0 0 16 16" aria-hidden="true">' +
		'<circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.4" fill="none"/>' +
		'<line x1="11" y1="11" x2="14.5" y2="14.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
		'</svg>',

	reset:
		'<svg viewBox="0 0 16 16" aria-hidden="true">' +
		'<path d="M3 8 A5 5 0 1 1 8 13" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>' +
		'<path d="M3 4 L3 8 L7 8" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
		'</svg>',

	// ─── Layer toggles ───
	crosshair:
		'<svg viewBox="0 0 16 16" aria-hidden="true">' +
		'<line x1="8" y1="1" x2="8" y2="15" stroke="currentColor" stroke-width="1.2"/>' +
		'<line x1="1" y1="8" x2="15" y2="8" stroke="currentColor" stroke-width="1.2"/>' +
		'<circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.2" fill="none"/>' +
		'</svg>',

	axisTime:
		'<svg viewBox="0 0 16 16" aria-hidden="true">' +
		'<line x1="2" y1="11" x2="14" y2="11" stroke="currentColor" stroke-width="1.4"/>' +
		'<line x1="4" y1="11" x2="4" y2="13" stroke="currentColor" stroke-width="1.4"/>' +
		'<line x1="8" y1="11" x2="8" y2="14" stroke="currentColor" stroke-width="1.4"/>' +
		'<line x1="12" y1="11" x2="12" y2="13" stroke="currentColor" stroke-width="1.4"/>' +
		'</svg>',

	axisValue:
		'<svg viewBox="0 0 16 16" aria-hidden="true">' +
		'<line x1="5" y1="2" x2="5" y2="14" stroke="currentColor" stroke-width="1.4"/>' +
		'<line x1="3" y1="4" x2="5" y2="4" stroke="currentColor" stroke-width="1.4"/>' +
		'<line x1="3" y1="8" x2="5" y2="8" stroke="currentColor" stroke-width="1.4"/>' +
		'<line x1="3" y1="12" x2="5" y2="12" stroke="currentColor" stroke-width="1.4"/>' +
		'</svg>',

	// ─── Card toggles ───
	legend:
		'<svg viewBox="0 0 16 16" aria-hidden="true">' +
		'<rect x="2" y="3" width="3" height="3" fill="currentColor"/>' +
		'<line x1="7" y1="4.5" x2="14" y2="4.5" stroke="currentColor" stroke-width="1.4"/>' +
		'<rect x="2" y="10" width="3" height="3" fill="currentColor"/>' +
		'<line x1="7" y1="11.5" x2="14" y2="11.5" stroke="currentColor" stroke-width="1.4"/>' +
		'</svg>',

	ohlc:
		'<svg viewBox="0 0 16 16" aria-hidden="true">' +
		'<line x1="5" y1="2" x2="5" y2="14" stroke="currentColor" stroke-width="1.2"/>' +
		'<rect x="4" y="5" width="2" height="6" fill="currentColor"/>' +
		'<line x1="11" y1="3" x2="11" y2="13" stroke="currentColor" stroke-width="1.2"/>' +
		'<rect x="10" y="6" width="2" height="4" fill="none" stroke="currentColor" stroke-width="1.2"/>' +
		'</svg>',

	info:
		'<svg viewBox="0 0 16 16" aria-hidden="true">' +
		'<rect x="3" y="2" width="10" height="12" rx="1" stroke="currentColor" stroke-width="1.4" fill="none"/>' +
		'<line x1="6" y1="6" x2="10" y2="6" stroke="currentColor" stroke-width="1.4"/>' +
		'<line x1="6" y1="9" x2="10" y2="9" stroke="currentColor" stroke-width="1.4"/>' +
		'<line x1="6" y1="12" x2="9" y2="12" stroke="currentColor" stroke-width="1.4"/>' +
		'</svg>',

	// ─── Controls ───
	fullscreen:
		'<svg viewBox="0 0 16 16" aria-hidden="true">' +
		'<path d="M3 6 L3 3 L6 3" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
		'<path d="M10 3 L13 3 L13 6" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
		'<path d="M13 10 L13 13 L10 13" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
		'<path d="M6 13 L3 13 L3 10" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
		'</svg>',

	fullscreenExit:
		'<svg viewBox="0 0 16 16" aria-hidden="true">' +
		'<path d="M6 3 L6 6 L3 6" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
		'<path d="M13 6 L10 6 L10 3" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
		'<path d="M10 13 L10 10 L13 10" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
		'<path d="M3 10 L6 10 L6 13" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
		'</svg>',

	add:
		'<svg viewBox="0 0 16 16" aria-hidden="true">' +
		'<line x1="8" y1="3" x2="8" y2="13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
		'<line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
		'</svg>',

	batch:
		'<svg viewBox="0 0 16 16" aria-hidden="true">' +
		'<polyline points="2,11 6,7 9,9 14,4" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
		'<polyline points="10,4 14,4 14,8" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
		'</svg>',

	play:
		'<svg viewBox="0 0 16 16" aria-hidden="true">' +
		'<path d="M4 2 L13 8 L4 14 Z" fill="currentColor"/>' +
		'</svg>',

	stop:
		'<svg viewBox="0 0 16 16" aria-hidden="true">' +
		'<rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor"/>' +
		'</svg>',

	strategy:
		'<svg viewBox="0 0 16 16" aria-hidden="true">' +
		'<path d="M2 12 L6 8 L10 11 L14 4" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
		'<circle cx="6" cy="8" r="1.2" fill="currentColor"/>' +
		'<circle cx="10" cy="11" r="1.2" fill="currentColor"/>' +
		'</svg>'
};

function buildFromMarkup(markup) {
	const wrapper = document.createElement('div');
	wrapper.innerHTML = markup.trim();
	const el = wrapper.firstElementChild;
	if (el) el.classList.add('icon');
	return el;
}

export const Icons = {

	/**
	 * Returns a fresh DOM element for the given spec.
	 *
	 * @param {string|Element|null} spec
	 *   - a registered icon name (e.g. 'pan')
	 *   - an SVG markup string (starts with '<')
	 *   - a DOM element (returned as-is)
	 *   - any other string (rendered as text — emoji fallback)
	 * @returns {Element|null}
	 */
	create(spec) {
		if (spec == null) return null;

		// DOM element passed directly.
		if (typeof spec === 'object' && spec.nodeType === 1) {
			return spec;
		}

		if (typeof spec !== 'string') return null;

		// Registered name.
		const markup = ICONS[spec];
		if (markup) return buildFromMarkup(markup);

		// Inline SVG markup.
		if (spec.trim().charAt(0) === '<') {
			return buildFromMarkup(spec);
		}

		// Anything else — treat as text (emoji, letter, symbol).
		const span = document.createElement('span');
		span.className = 'icon icon-text';
		span.textContent = spec;
		return span;
	},

	/**
	 * Returns the raw SVG markup for a registered name, or null.
	 */
	svg(name) {
		return ICONS[name] || null;
	},

	/**
	 * True if the given name is registered.
	 */
	has(name) {
		return Object.prototype.hasOwnProperty.call(ICONS, name);
	},

	/**
	 * List of registered icon names.
	 */
	names() {
		return Object.keys(ICONS);
	}
};

export default Icons;