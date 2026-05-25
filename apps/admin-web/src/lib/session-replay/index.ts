/**
 * Public surface of the session-replay library — Central Command Phase B
 * (B5). The replay event stream is held SEPARATELY from the 14-event
 * sensorium taxonomy (`src/lib/sensorium`). rrweb chunks at ≈20Hz
 * mouse-move sampling live here; they are NEVER fed into the LLM
 * context window.
 */

export {
  buildDefaultMaskConfig,
  DEFAULT_MASK_TEXT_SELECTOR,
  isPiiElement,
  scrubPiiPatterns,
  type RrwebMaskConfig,
} from './pii-mask.js';

export {
  createChunkUploader,
  type ChunkUploader,
  type ChunkUploaderConfig,
  type ChunkUploaderStats,
  type SessionReplayChunk,
} from './chunk-uploader.js';

export {
  startSessionReplayRecorder,
  type RecorderConfig,
  type RecorderHandle,
  type RrwebEvent,
  type RrwebRecordFactory,
  type RrwebRecordOptions,
  type RrwebRecordStopper,
} from './recorder.js';
