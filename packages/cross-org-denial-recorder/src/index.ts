/**
 * `@borjie/cross-org-denial-recorder` — public surface.
 *
 * Records every cross-tenant denial (PO-21). Plug-in `DenialSink` for
 * persistence; pure aggregator + brute-force scanner.
 */

export * from "./types.js";
export {
  recordDenial,
  createRecorderState,
  type RecorderOptions,
  type RecorderState,
} from "./recorder.js";
export {
  aggregate,
  findBruteForcePatterns,
  type ScanThresholds,
} from "./scanner.js";
export {
  createInMemorySink,
  type InMemorySink,
} from "./in-memory-sink.js";
