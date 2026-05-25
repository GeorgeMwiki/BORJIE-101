/**
 * `@borjie/memory-tool-wire-adapter` — public surface.
 *
 * Bidirectional wire-format adapter between BORJIE's internal
 * topic-files memory shape and the Anthropic Managed Agents Memory
 * Tool protocol (PO-9). Pure functions; no I/O.
 */

export * from "./types.js";
export {
  TOPIC_RE,
  PATH_PREFIX,
  PATH_SUFFIX,
  topicToPath,
  pathToTopic,
  topicFilesToMemoryWire,
  memoryWireToTopicFiles,
  buildMemoryCreate,
  buildMemoryRead,
  buildMemoryUpdate,
  buildMemoryDelete,
  buildMemoryList,
} from "./adapter.js";
