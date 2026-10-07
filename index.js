// ──────────────────────────────────────────────────────────────
// index.js — public API
// ──────────────────────────────────────────────────────────────

// Core
export { Layer } from './core/Layer.js';
export { ChartLayer } from './core/ChartLayer.js';
export { AnnotationLayer } from './core/AnnotationLayer.js';
export { CartesianPlane } from './core/CartesianPlane.js';
export { Scale } from './core/Scale.js';
export { Events, EventEmitter } from './core/Events.js';
export { Utils } from './core/Utils.js';
export { SVG } from './core/SVG.js';
export { CSS } from './core/CSS.js';

// Axes
export { Axis } from './axes/Axis.js';
export { XAxis } from './axes/XAxis.js';
export { YAxis } from './axes/YAxis.js';

// Layers
export { Line } from './layers/Line.js';
export { Area } from './layers/Area.js';
export { Points } from './layers/Points.js';
export { GhostLine } from './layers/GhostLine.js';
export { BandFill } from './layers/BandFill.js';
export { BarChart } from './layers/BarChart.js';
export { CandleStick } from './layers/CandleStick.js';
export { ReferenceLine } from './layers/ReferenceLine.js';

// Interaction
export { ChartSelection } from './interaction/ChartSelection.js';
export { Selection } from './interaction/Selection.js';
export { CrosshairLayer } from './interaction/CrosshairLayer.js';
export { InteractionLayer } from './interaction/InteractionLayer.js';

// Cards
export { CardStrip } from './cards/CardStrip.js';
export { Legend } from './cards/Legend.js';
export { OHLCCard } from './cards/OHLCCard.js';
export { InfoCard } from './cards/InfoCard.js';

// UI
export { Button } from './ui/Button.js';
export { ToolBar } from './ui/ToolBar.js';
export { ToolTip } from './ui/ToolTip.js';