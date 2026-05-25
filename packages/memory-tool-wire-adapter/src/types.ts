/**
 * Memory Tool wire-format adapter — public types.
 *
 * Bridges BORJIE's internal topic-files memory shape with the
 * Anthropic Managed Agents Memory Tool protocol (released as
 * `managed-agents-2026-04-01`). Lets external Anthropic-hosted callers
 * speak BORJIE's curated property/tenant memory without rewriting
 * the schema.
 *
 * Memory Tool protocol (from Anthropic docs, May 2026):
 *
 *   /memories/<topic>.md
 *   - create: { path, content }
 *   - read:   { path } -> content
 *   - list:   { dir }  -> string[]
 *   - update: { path, content }
 *   - delete: { path }
 *
 * Topic naming rules:
 *   - lowercase letters, digits, dashes
 *   - 1..64 chars
 *   - must start with [a-z0-9]
 */

/** Internal BORJIE topic-file snapshot. */
export interface TopicFileSnapshot {
  /** Stable topic identifier — letters, digits, dashes; lowercase. */
  readonly topic: string;
  /** Curated markdown body. */
  readonly content: string;
  /** ISO 8601 last-modified timestamp. */
  readonly lastModifiedIso?: string;
  /** Optional metadata for round-trip integrity. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Anthropic Memory Tool file as it appears on the wire. */
export interface MemoryToolFile {
  /** Anthropic-format path. Always `/memories/<topic>.md`. */
  readonly path: string;
  /** Full file body. */
  readonly content: string;
  /** ISO 8601 last-modified. */
  readonly lastModifiedIso?: string;
}

/** Error surfaced by either direction of the adapter. */
export interface AdapterError {
  readonly kind:
    | "invalid_topic"
    | "invalid_path"
    | "duplicate_topic"
    | "empty_content";
  readonly message: string;
  readonly offending: string;
}

export interface ToWireResult {
  readonly files: ReadonlyArray<MemoryToolFile>;
  readonly errors: ReadonlyArray<AdapterError>;
}

export interface FromWireResult {
  readonly snapshots: ReadonlyArray<TopicFileSnapshot>;
  readonly errors: ReadonlyArray<AdapterError>;
}

/** Anthropic Memory Tool command shape (the request body to send). */
export type MemoryToolCommand =
  | { readonly action: "create"; readonly path: string; readonly content: string }
  | { readonly action: "read"; readonly path: string }
  | { readonly action: "update"; readonly path: string; readonly content: string }
  | { readonly action: "delete"; readonly path: string }
  | { readonly action: "list"; readonly dir: string };
