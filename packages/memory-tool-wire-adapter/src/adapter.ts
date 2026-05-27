/**
 * Memory Tool wire-format adapter — bidirectional.
 *
 * Pure functions, no I/O. Caller supplies snapshots; adapter returns
 * the other-direction shape plus structured errors for invalid topics
 * or paths.
 */

import type {
  AdapterError,
  FromWireResult,
  MemoryToolCommand,
  MemoryToolFile,
  ToWireResult,
  TopicFileSnapshot,
} from "./types.js";

export const TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const PATH_PREFIX = "/memories/";
export const PATH_SUFFIX = ".md";

export function topicToPath(topic: string): string {
  return `${PATH_PREFIX}${topic}${PATH_SUFFIX}`;
}

export function pathToTopic(path: string): string | null {
  if (!path.startsWith(PATH_PREFIX) || !path.endsWith(PATH_SUFFIX)) return null;
  return path.slice(PATH_PREFIX.length, -PATH_SUFFIX.length);
}

// ---------------------------------------------------------------------------
// BORJIE -> Anthropic Memory Tool wire
// ---------------------------------------------------------------------------

/**
 * Convert internal topic-files into the Anthropic Memory Tool wire
 * format. Invalid topic names are surfaced as errors; valid topics
 * are converted. Duplicate topics keep the most recently modified
 * version (`lastModifiedIso` wins).
 */
export function topicFilesToMemoryWire(
  snapshots: ReadonlyArray<TopicFileSnapshot>,
): ToWireResult {
  const errors: AdapterError[] = [];
  const seen = new Map<string, TopicFileSnapshot>();

  for (const s of snapshots) {
    if (!TOPIC_RE.test(s.topic)) {
      errors.push({
        kind: "invalid_topic",
        message:
          "Topic must match /^[a-z0-9][a-z0-9-]{0,63}$/ — lowercase letters, digits, dashes; starts alphanumeric.",
        offending: s.topic,
      });
      continue;
    }
    const existing = seen.get(s.topic);
    if (existing) {
      const existingMs = existing.lastModifiedIso
        ? Date.parse(existing.lastModifiedIso)
        : 0;
      const candidateMs = s.lastModifiedIso
        ? Date.parse(s.lastModifiedIso)
        : 0;
      if (candidateMs > existingMs) {
        seen.set(s.topic, s);
      }
      errors.push({
        kind: "duplicate_topic",
        message: `Duplicate topic; keeping the version with the more recent lastModifiedIso.`,
        offending: s.topic,
      });
    } else {
      seen.set(s.topic, s);
    }
  }

  const files: MemoryToolFile[] = [];
  for (const s of seen.values()) {
    files.push({
      path: topicToPath(s.topic),
      content: s.content,
      ...(s.lastModifiedIso !== undefined
        ? { lastModifiedIso: s.lastModifiedIso }
        : {}),
    });
  }
  return { files, errors };
}

// ---------------------------------------------------------------------------
// Anthropic Memory Tool wire -> BORJIE
// ---------------------------------------------------------------------------

/**
 * Convert an Anthropic Memory Tool snapshot back into BORJIE
 * topic-files shape. Paths that don't match `/memories/<topic>.md`
 * are surfaced as errors. Empty content rejects with `empty_content`
 * — Anthropic's Memory Tool spec disallows empty file bodies.
 */
export function memoryWireToTopicFiles(
  files: ReadonlyArray<MemoryToolFile>,
): FromWireResult {
  const snapshots: TopicFileSnapshot[] = [];
  const errors: AdapterError[] = [];

  for (const f of files) {
    const topic = pathToTopic(f.path);
    if (!topic) {
      errors.push({
        kind: "invalid_path",
        message: "Memory tool path must start with /memories/ and end with .md",
        offending: f.path,
      });
      continue;
    }
    if (!TOPIC_RE.test(topic)) {
      errors.push({
        kind: "invalid_topic",
        message: `Path contained an invalid topic segment "${topic}".`,
        offending: f.path,
      });
      continue;
    }
    if (f.content.length === 0) {
      errors.push({
        kind: "empty_content",
        message: "Memory Tool file body is empty (spec disallows).",
        offending: f.path,
      });
      continue;
    }
    snapshots.push({
      topic,
      content: f.content,
      ...(f.lastModifiedIso !== undefined
        ? { lastModifiedIso: f.lastModifiedIso }
        : {}),
    });
  }
  return { snapshots, errors };
}

// ---------------------------------------------------------------------------
// Memory Tool protocol command builders
// ---------------------------------------------------------------------------

export function buildMemoryCreate(
  topic: string,
  content: string,
): MemoryToolCommand {
  return { action: "create", path: topicToPath(topic), content };
}

export function buildMemoryRead(topic: string): MemoryToolCommand {
  return { action: "read", path: topicToPath(topic) };
}

export function buildMemoryUpdate(
  topic: string,
  content: string,
): MemoryToolCommand {
  return { action: "update", path: topicToPath(topic), content };
}

export function buildMemoryDelete(topic: string): MemoryToolCommand {
  return { action: "delete", path: topicToPath(topic) };
}

export function buildMemoryList(): MemoryToolCommand {
  return { action: "list", dir: PATH_PREFIX };
}
