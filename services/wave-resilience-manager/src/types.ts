/**
 * Core types for the wave-resilience-manager.
 *
 * Per AGENT_SELF_REVIVAL_SPEC §5 (WaveProgressLedger contract) +
 * §4 (Lifecycle state machine). Pure type module — no I/O.
 */

export const WAVE_STATUSES = [
  'dispatched',
  'running',
  'checkpoint',
  'completed',
  'crashed',
  'revivable',
  'resuming',
  'unrecoverable',
] as const;

export type WaveStatus = (typeof WAVE_STATUSES)[number];

/**
 * The five standard checkpoint labels every agent should emit. The
 * resilience manager understands these as discrete resume points.
 * Agents are free to declare additional labels — the system treats
 * unknown labels as "some intermediate step completed" and uses them
 * for ordering only.
 */
export const STANDARD_CHECKPOINT_LABELS = [
  'audit_complete',
  'spec_drafted',
  'package_scaffolded',
  'committed',
  'pushed',
] as const;

export type StandardCheckpointLabel =
  (typeof STANDARD_CHECKPOINT_LABELS)[number];

export interface WaveProgressEntry {
  readonly id: string;
  readonly wave_id: string;
  readonly agent_id: string;
  readonly tenant_id: string | null;
  readonly status: WaveStatus;
  readonly checkpoint_seq: number;
  readonly checkpoint_label: string | null;
  readonly checkpoint_payload: Record<string, unknown> | null;
  readonly heartbeat_at: string; // ISO
  readonly attempt_number: number;
  readonly created_at: string; // ISO
  readonly audit_hash: string;
}

export interface WaveRevivalAttempt {
  readonly id: string;
  readonly wave_id: string;
  readonly attempt_number: number;
  readonly original_dispatch_at: string;
  readonly crashed_at: string;
  readonly resumed_at: string | null;
  readonly completed_at: string | null;
  readonly outcome: 'completed' | 'crashed_again' | 'gave_up' | null;
  readonly audit_hash: string;
}

export interface RevivalDecision {
  readonly wave_id: string;
  readonly should_revive: boolean;
  readonly last_completed_checkpoint: string | null;
  readonly continuation_prompt: string;
  readonly attempt_number: number;
  readonly reason: string;
}

/**
 * Per-wave summary used by `GET /report` for the admin UI. One row per
 * `wave_id`, collapsing many `wave_progress` rows.
 */
export interface WaveHealthRow {
  readonly wave_id: string;
  readonly status: WaveStatus;
  readonly last_checkpoint_label: string | null;
  readonly last_heartbeat_at: string;
  readonly attempt_number: number;
  readonly created_at: string;
}

/**
 * Minimal logger duck-type — kept local so the package has no runtime
 * dep on pino / winston.
 */
export interface ResilienceLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export const MAX_ATTEMPTS = 3 as const;

/** Default heartbeat-staleness threshold (5 minutes per spec §3 R2). */
export const DEFAULT_STALE_HEARTBEAT_MS = 5 * 60_000;

/** Default detector sweep cadence (60 s per spec §3 R2). */
export const DEFAULT_DETECTOR_INTERVAL_MS = 60_000;
