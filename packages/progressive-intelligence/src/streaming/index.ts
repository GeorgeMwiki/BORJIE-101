/**
 * Public surface for streaming inference. SSE encoder is exported
 * separately so callers using WebSockets can skip it.
 */
export {
  streamInference,
  streamInferenceAsSse,
  encodeSse,
  type StreamInferenceArgs,
} from './stream.js';
