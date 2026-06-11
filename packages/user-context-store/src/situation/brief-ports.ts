/**
 * Standing-brief read-only ports.
 *
 * The brief is synthesized from memory + audit + open workflows. This
 * package owns NO I/O — the host injects these read-only ports, each
 * backed by the real source (cognitive-memory, ai_audit_chain,
 * workflow-engine, world-model forecasts, the situational fragments the
 * spec lists as disjoint).
 *
 * Every port is READ-ONLY by contract: it returns already-materialized
 * facts. The brief never writes back. This keeps the situational layer
 * additive and unable to touch the audit chain or money path.
 */

/** A completed/past event from episodic memory + the audit chain. */
export interface HappenedRecord {
  readonly id: string;
  readonly summary: string;
  /** ISO-8601 of when it happened. */
  readonly at: string;
  /** LLM/heuristic importance 1-10 (Generative-Agents). */
  readonly importance: number;
  readonly evidenceKind: 'audit' | 'memory';
  readonly evidenceId: string;
}

/** An in-flight goal / sub-MD / loop cycle from the agency goal-tracker. */
export interface DoingRecord {
  readonly id: string;
  readonly summary: string;
  readonly startedAt: string;
  readonly importance: number;
  /** workflow run id or goal id backing it. */
  readonly evidenceId: string;
  readonly evidenceKind: 'workflow' | 'memory';
}

/** A pending / blocked / stalled item from the goal-tracker + stall-detector. */
export interface ToDoRecord {
  readonly id: string;
  readonly summary: string;
  readonly state: 'pending' | 'blocked' | 'stalled';
  readonly importance: number;
  /** Optional ISO-8601 deadline (drives priority). */
  readonly dueAt?: string;
  readonly evidenceId: string;
  readonly evidenceKind: 'workflow' | 'memory';
}

/** A forecast / dated future event from the world-model. */
export interface FutureRecord {
  readonly id: string;
  readonly summary: string;
  /** ISO-8601 when it becomes live. */
  readonly dueAt: string;
  readonly importance: number;
  readonly evidenceId: string;
}

/** A known-unknown the host has already identified (gaps in coverage). */
export interface BlindSpotRecord {
  readonly id: string;
  readonly summary: string;
  readonly blocksDecision: string;
  readonly resolutionHint: string;
  readonly importance: number;
  readonly evidenceId: string;
  readonly evidenceKind: 'memory' | 'signal';
}

/**
 * The read-only source set. Any port may be omitted — a missing facet
 * just yields an empty array (graceful degradation, never throws).
 */
export interface BriefSources {
  readonly happened?: () => Promise<ReadonlyArray<HappenedRecord>>;
  readonly doing?: () => Promise<ReadonlyArray<DoingRecord>>;
  readonly toDo?: () => Promise<ReadonlyArray<ToDoRecord>>;
  readonly future?: () => Promise<ReadonlyArray<FutureRecord>>;
  readonly blindSpots?: () => Promise<ReadonlyArray<BlindSpotRecord>>;
}
