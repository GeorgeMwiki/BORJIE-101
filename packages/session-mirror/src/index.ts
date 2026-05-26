/**
 * `@borjie/session-mirror` — public surface.
 *
 * Universal observability scaffold per
 * `Docs/DESIGN/UNIVERSAL_OBSERVABILITY_SPEC.md` (Wave 18R). Provides:
 *
 *   - Tier II — `FieldStateMirror` types + client capture hook + server-side
 *     read factory. The MD reads live in-flight form values through here.
 *   - Tier III — `UiStateGraph` types + client beacon hook + server-side
 *     read factory. The MD reads the live workspace topology through here.
 *   - Provider — `SessionMirrorProvider` binds session scope, batches
 *     captures, ships them to `/api/v1/session-mirror/capture`.
 *
 * Tier I (`UniversalDataAccess`) is sketched at the type level; the
 * concrete query builders live in `@borjie/database` and are wired
 * into the api-gateway's per-turn `OrgUserDataContext` factory.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  ArbitraryQuerySpec,
  CaptureBatch,
  CaptureEvent,
  FieldStateMirror,
  FieldValue,
  HoverTarget,
  LastUserEvent,
  PiiKind,
  QueryBuilderBase,
  TabState,
  UiStateGraph,
} from './types.js';

// ---------------------------------------------------------------------------
// Field capture (Tier II)
// ---------------------------------------------------------------------------

export {
  useFieldCapture,
  type UseFieldCaptureArgs,
  type UseFieldCaptureReturn,
} from './field-capture/use-field-capture.js';

export { classify, redact } from './field-capture/pii-redactor.js';
export type { RedactArgs } from './field-capture/pii-redactor.js';

export {
  emitFieldChange,
  type EmitFieldChangeArgs,
} from './field-capture/emit-field-change.js';

export {
  Debouncer,
  type DebouncerOptions,
} from './field-capture/debouncer.js';

// ---------------------------------------------------------------------------
// UI beacon (Tier III)
// ---------------------------------------------------------------------------

export {
  useUiStateBeacon,
  type UseUiStateBeaconArgs,
} from './ui-beacon/use-ui-state-beacon.js';

export { digestOf } from './ui-beacon/digest.js';
export { buildGraph, type BuildGraphArgs } from './ui-beacon/build-graph.js';

// ---------------------------------------------------------------------------
// Provider + batch flusher
// ---------------------------------------------------------------------------

export {
  SessionMirrorProvider,
  useCaptureEmit,
  useSessionScope,
  type SessionMirrorProviderProps,
  type SessionScope,
} from './provider/session-mirror-provider.js';

export {
  BatchFlusher,
  type BatchFlusherOptions,
} from './provider/batch-flusher.js';

// ---------------------------------------------------------------------------
// Capture client
// ---------------------------------------------------------------------------

export {
  buildBatch,
  createCaptureClient,
  type CaptureClient,
  type CaptureClientOptions,
} from './capture-client/capture-client.js';

// ---------------------------------------------------------------------------
// Snapshot readers (server-side)
// ---------------------------------------------------------------------------

export {
  createFieldStateMirror,
  type CreateFieldStateMirrorArgs,
  type FieldStateRow,
  type FieldStateRowStore,
} from './snapshot-reader/field-state-mirror-factory.js';

export {
  emptyGraph,
  readUiStateGraph,
  type CreateUiStateGraphArgs,
  type UiStateRowStore,
} from './snapshot-reader/ui-state-graph-factory.js';
