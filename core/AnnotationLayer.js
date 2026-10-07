// ──────────────────────────────────────────────────────────────
// AnnotationLayer.js - Base class for overlays (no domain)
// ──────────────────────────────────────────────────────────────

import { Layer } from './Layer.js';

export class AnnotationLayer extends Layer {
	constructor(options = {}) {
		super(options);

		// In AnnotationLayer constructor:
		this.slot = 'annotations';

		// ─── Mark as non-data layer ───
		this.isDataLayer = false;
		this.needsMargin = false;

		// ─── Source layer (for anchoring) ───
		this.sourceLayer = options.sourceLayer || null;
	}

	// No getStats() — does not contribute to domain
}

export default AnnotationLayer;