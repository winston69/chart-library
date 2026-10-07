// ──────────────────────────────────────────────────────────────
// Events.js - Central Event System
// ──────────────────────────────────────────────────────────────

export const Events = {

	// ─── SELECTION EVENTS ───
	SELECTION_CHANGED: 'selection:changed',

	// ─── DATA EVENTS ───
	DATA_UPDATED: 'data:updated',
	DATA_APPENDED: 'data:appended',
	DATA_CLEARED: 'data:cleared',
	DATA_RESET: 'data:reset',

	// ─── POINT EVENTS ───
	POINT_ADDED: 'point:added',
	POINT_REMOVED: 'point:removed',
	LAST_POINT_UPDATED: 'point:last:updated',

	// ─── LAYER EVENTS ───
	LAYER_ADDED: 'layer:added',
	LAYER_REMOVED: 'layer:removed',
	LAYER_UPDATED: 'layer:updated',
	LAYER_WILL_REMOVE: 'layer:will:remove',

	// ─── PLANE EVENTS ───
	PLANE_MOUNTED: 'plane:mounted',
	PLANE_UPDATED: 'plane:updated',
	PLANE_RESIZED: 'plane:resized',
	PLANE_DESTROYED: 'plane:destroyed',

	// ─── LAYOUT EVENTS ───
	LAYOUT_CHANGED: 'layout:changed',
	MARGINS_CHANGED: 'margins:changed',

	// ─── SCALE EVENTS ───
	SCALE_RANGE_CHANGED: 'scale:range_changed',
	SCALE_DOMAIN_CHANGED: 'scale:domain_changed',

	// ─── DOMAIN EVENTS ───
	DOMAIN_CHANGED: 'domain:changed',
	STRATEGY_CHANGED: 'strategy:changed',

	// ─── ANIMATION EVENTS ───
	ANIMATION_START: 'animation:start',
	ANIMATION_STOP: 'animation:stop',
	ANIMATION_COMPLETE: 'animation:complete',

	// ─── TOOLBAR EVENTS ───
	TOOLBAR_ITEM_CLICKED: 'toolbar:item_clicked',
	TOOLBAR_ITEM_TOGGLED: 'toolbar:item_toggled',

	// ─── COORDINATE SYSTEM EVENTS ───
	TRANSFORM_CHANGED: 'transform:changed',
	COORDINATE_SYSTEM_READY: 'coords:ready',

	// ─── VIEWPORT EVENTS ───
	VIEWPORT_CHANGED: 'viewport:changed',
	VIEWPORT_RESET: 'viewport:reset',

	// ─── Y-GROUP EVENTS ───
	YGROUP_DOMAIN_CHANGED: 'ygroup:domain_changed',
	YGROUP_LAYOUT_CHANGED: 'ygroup:layout_changed',

	INTERACTION_MODE_CHANGED: 'interaction:mode-changed',

	// ─── VIEWPORT EVENTS ───
	VIEWPORT_CHANGED: 'viewport:changed',
	VIEWPORT_RESET: 'viewport:reset',
	FULLSCREEN_CHANGED: 'fullscreen:changed',
};

export class EventEmitter {
	constructor() {
		// ─── Use Object.create(null) for events ───
		this._events = Object.create(null);

		// ─── Monotonic listener ID (safe: survives ~9 quadrillion registrations) ───
		this._nextListenerId = 0;
	}

	/**
	 * Collect all listener entries for an event.
	 */
	_collectListeners(event) {
		const listeners = this._events[event];
		if (!listeners) return null;

		const entries = [];
		for (const id in listeners) {
			entries.push(listeners[id]);
		}
		return entries;
	}

	/**
	 * Register an event listener
	 * @param {string} event - Event name
	 * @param {Function} callback - Callback function
	 * @param {Object} context - Context to bind callback to
	 * @returns {Function} - Unsubscribe function
	 */
	on(event, callback, context = null) {
		if (!this._events[event]) {
			this._events[event] = Object.create(null);
		}

		const id = ++this._nextListenerId;
		this._events[event][id] = { callback, context, id };

		return () => {
			const listeners = this._events[event];
			if (listeners) {
				delete listeners[id];
				// ─── Check if any listeners remain ───
				const entries = this._collectListeners(event);
				if (!entries || entries.length === 0) {
					delete this._events[event];
				}
			}
		};
	}

	/**
	 * Register a one-time event listener
	 * @param {string} event - Event name
	 * @param {Function} callback - Callback function
	 * @param {Object} context - Context to bind callback to
	 * @returns {Function} - Unsubscribe function
	 */
	once(event, callback, context = null) {
		const unsubscribe = this.on(event, (...args) => {
			unsubscribe();
			callback.apply(context, args);
		}, context);
		return unsubscribe;
	}

	/**
	 * Emit an event
	 * @param {string} event - Event name
	 * @param {*} data - Event data
	 * @returns {boolean} - Whether any listeners were called
	 */
	emit(event, data = null) {
		const entries = this._collectListeners(event);
		if (!entries) return false;

		for (let i = 0, len = entries.length; i < len; i++) {
			const { callback, context } = entries[i];
			try {
				callback.call(context || this, data, event);
			} catch (error) {
				console.error(`Error in event listener for "${event}":`, error);
			}
		}

		return true;
	}

	/**
	 * Remove all listeners for an event
	 * @param {string} event - Event name (optional)
	 */
	off(event = null) {
		if (event) {
			delete this._events[event];
		} else {
			this._events = Object.create(null);
		}
	}

	/**
	 * Get all registered event names
	 * @returns {Array<string>}
	 */
	getEvents() {
		const result = [];
		for (const event in this._events) {
			result.push(event);
		}
		return result;
	}

	/**
	 * Get number of listeners for an event
	 * @param {string} event - Event name
	 * @returns {number}
	 */
	listenerCount(event) {
		const entries = this._collectListeners(event);
		return entries ? entries.length : 0;
	}

	/**
	 * Check if an event has listeners
	 * @param {string} event - Event name
	 * @returns {boolean}
	 */
	hasListeners(event) {
		return this.listenerCount(event) > 0;
	}
}

// ─── GLOBAL EVENT BUS ───
export const eventBus = new EventEmitter();

export default Events;