/**
 * @borjie/genui streaming-artifact contract (LP-24b).
 *
 * Three framework-free pieces for streaming generative UI:
 *   1. artifact-stream-parser — `<artifact>` open/delta/close state machine.
 *   2. streaming-artifact      — typed StreamingArtifact<T> + writer + reducer.
 *   3. choreography(-engine)    — pure timed-reveal state machine.
 *
 * All pure / dependency-free so they run server-side (SSE proxy, jobs)
 * and client-side (React hooks) from one source of truth.
 */

export {
  createChatArtifactStreamParser,
  type ChatArtifactStreamParser,
  type ArtifactStreamEvent,
  type ArtifactStreamEventType,
  type ArtifactOpenEvent,
  type ArtifactDeltaEvent,
  type ArtifactCloseEvent,
  type ArtifactStreamSink,
} from "./artifact-stream-parser";

export {
  createArtifactWriter,
  createInMemoryArtifactTransport,
  reduceArtifactChunk,
  assembleArtifact,
  type ArtifactChunk,
  type ArtifactChunkKind,
  type ArtifactTransport,
  type ArtifactWriter,
  type ArtifactWriterClock,
  type StreamingArtifact,
  type StreamingArtifactStatus,
} from "./streaming-artifact";

export {
  sortRevealsByTime,
  totalChoreographyMs,
  type BlackboardChoreography,
  type RevealCue,
  type VoiceMarker,
  type StoryShape,
  type InteractionResponse,
} from "./choreography";

export {
  initChoreographyState,
  tickChoreography,
  applyInteraction,
  type ChoreographyState,
  type ChoreographyTickEvent,
} from "./choreography-engine";

export {
  useChoreography,
  staggeredReveal,
  type UseChoreographyResult,
  type UseChoreographyOptions,
} from "./use-choreography";
