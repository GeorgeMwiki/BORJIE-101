/**
 * Ambient module shims for peer-dep libraries that ship without
 * .d.ts (or whose types are too narrow to bother with). Every viz lib
 * is dynamically imported inside an effect and immediately cast
 * through a local interface, so shipping these as `unknown` is the
 * least leaky public surface.
 */

declare module 'd3-sankey';
declare module 'd3-force';
declare module 'graphology';
declare module 'sigma';
declare module 'echarts-for-react';
declare module 'reactflow';
declare module 'cytoscape';
declare module 'vis-network';
