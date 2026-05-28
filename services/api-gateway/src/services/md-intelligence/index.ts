/**
 * MD intelligence — barrel.
 *
 * Cross-domain intelligence layer that turns "AI assistant" into "AI
 * Managing Director". Four pure-functional modules:
 *
 *   - signal-graph        the typed, frozen graph of cross-domain edges
 *   - correlation-engine  which OTHER domains the asked-about state touches
 *   - causation-tracer    walk upstream from a symptom to surface root causes
 *   - comparison-framework  tenant vs historical / peer / external benchmark
 *   - insight-emitter     0-3 NON-OBVIOUS, GROUNDED insights per turn
 *
 * Hard rules:
 *   - Every insight must be grounded in real data points returned in the
 *     same turn (no fake numbers).
 *   - Correlational edges are surfaced separately from causal edges.
 *   - All four modules are pure async functions; the brain tools layer
 *     wires them up with the tenant scope.
 */

export {
  SIGNAL_EDGES,
  outboundEdges,
  inboundEdges,
  topTouchesForNode,
  referencedNodes,
  domainOf,
  type SignalEdge,
  type SignalEdgeKind,
  type SignalEdgeDirection,
} from './signal-graph';

export {
  correlate,
  type CorrelationScope,
  type LiveSignalProbe,
  type TouchEdge,
  type CorrelationResult,
  type CorrelateInput,
} from './correlation-engine';

export {
  trace,
  type CausationScope,
  type PresenceProbe,
  type CausalStep,
  type CausalChain,
  type TraceResult,
  type TraceInput,
} from './causation-tracer';

export {
  compare,
  type ComparisonScope,
  type HistoricalBaseline,
  type PeerBaseline,
  type BenchmarkBaseline,
  type ComparisonResult,
  type HistoricalReader,
  type PeerReader,
  type BenchmarkReader,
  type ComparisonReaders,
  type CompareInput,
} from './comparison-framework';

export {
  emit,
  type InsightKind,
  type InsightHeadline,
  type InsightAction,
  type Insight,
  type FullPictureEntry,
  type EmitInsightsInput,
  type EmitInsightsResult,
} from './insight-emitter';
