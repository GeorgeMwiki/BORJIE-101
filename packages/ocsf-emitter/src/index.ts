/**
 * `@borjie/ocsf-emitter` — public surface.
 *
 * OCSF 1.5 audit emitter for SIEM ingestion (PO-16). Maps internal
 * audit events to OCSF envelopes with PII redaction; pluggable sink
 * for syslog / HTTP / file / Sentinel / Splunk.
 */

export * from "./ocsf-constants.js";
export * from "./types.js";
export { stripPii, deepStripPii, type StripResult } from "./redaction.js";
export {
  mapInternalEventToOcsf,
  type MapOptions,
} from "./map-event.js";
export {
  emitEvent,
  createInMemorySink,
  createLineSink,
  type EmitResult,
  type LineWriter,
} from "./emit.js";
