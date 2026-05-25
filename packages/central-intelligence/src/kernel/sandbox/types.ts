/**
 * Sandbox types — public surface for the V8-isolate JS sandbox.
 *
 * Ported from LITFIN (`src/core/litfin-ai/sandbox/js-sandbox.ts`) and
 * adapted to Borjie's central-intelligence kernel conventions:
 *
 *   - All inputs/outputs are `readonly` so callers cannot mutate a
 *     SandboxResult after it has been returned.
 *   - Errors carry a typed `code` discriminator so callers can branch
 *     on the failure mode without parsing a free-text message.
 *   - The audit port is a plain function so the kernel's existing
 *     audit-sink infrastructure can adapt to it without coupling.
 *
 * No host references (functions, proxies, Buffers, Promises) ever
 * cross the sandbox boundary into the parent — `result` is always a
 * JSON-clonable primitive or plain object.
 */

/** Discriminator codes for SandboxError. Keep stable; logged + asserted. */
export type SandboxErrorCode =
  /** Snippet failed the 5 KB / 5 KB-UTF8 / non-empty validation. */
  | 'SANDBOX_CODE_TOO_LARGE'
  /** Snippet was empty / not a string. */
  | 'SANDBOX_CODE_INVALID'
  /** Wall-clock timeout fired inside V8 (or worker fallback). */
  | 'SANDBOX_TIMEOUT'
  /** V8 isolate memory cap (8 MB) was exceeded. */
  | 'SANDBOX_MEMORY_EXCEEDED'
  /** Snippet threw an exception during execution. */
  | 'SANDBOX_THROW'
  /** Result was not structured-clonable (e.g. function, proxy, symbol). */
  | 'SANDBOX_RESULT_NOT_CLONABLE'
  /** Native binding / isolate init failed (isolated-vm not installed, etc). */
  | 'SANDBOX_INIT_FAILED'
  /** Unknown / unexpected error path. */
  | 'SANDBOX_UNKNOWN';

export interface SandboxError {
  readonly code: SandboxErrorCode;
  readonly message: string;
}

export interface SandboxOptions {
  /**
   * Caller-requested wall-clock ceiling in milliseconds. Clamped into
   * `[1, MAX_TIMEOUT_MS]` (5000ms hard cap). Callers may shorten the
   * cap but cannot extend it beyond the kernel-wide hard limit.
   */
  readonly timeoutMs?: number;
  /**
   * Per-call memory cap in megabytes. Clamped into `[1, MAX_MEMORY_MB]`
   * (8 MB hard cap). Default is the hard cap.
   */
  readonly memoryMb?: number;
  /**
   * Optional audit port. Invoked synchronously on every sandbox call
   * (success or failure) with a structured event the caller's
   * audit-sink can persist. Errors thrown from the auditor are
   * swallowed so the snippet result is never blocked on audit failure.
   */
  readonly auditor?: SandboxAuditor;
  /**
   * Opaque tag added to audit events. Lets the caller correlate sandbox
   * invocations with the outer agent turn / tool call.
   */
  readonly callerTag?: string;
}

/**
 * Result of a sandbox invocation. Always discriminated by `ok`:
 *   - `ok: true`  → `result` is a JSON-clonable value; `error` absent.
 *   - `ok: false` → `error` populated; `result` absent.
 *
 * `durationMs` and `memoryUsedBytes` are populated on both paths so
 * the audit trail records resource consumption for failed runs too.
 */
export interface SandboxResult {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: SandboxError;
  readonly durationMs: number;
  /**
   * Approximate V8 heap bytes used by the isolate, sampled at
   * tear-down via `getHeapStatisticsSync`. Zero when the fallback
   * `vm` backend is used (Node's vm module shares the host heap so
   * we cannot attribute a per-call number).
   */
  readonly memoryUsedBytes: number;
}

/**
 * Structured audit event the sandbox emits on every invocation. The
 * sink owns whether to persist, redact, or drop the event — the
 * sandbox itself is stateless and just forwards.
 */
export interface SandboxAuditEvent {
  readonly at: Date;
  readonly callerTag?: string;
  readonly codeBytes: number;
  readonly timeoutMs: number;
  readonly memoryMb: number;
  readonly ok: boolean;
  readonly errorCode?: SandboxErrorCode;
  readonly durationMs: number;
  readonly memoryUsedBytes: number;
  /** Backend that handled the call — useful for forensic correlation. */
  readonly backend: SandboxBackend;
}

export type SandboxBackend = 'isolated-vm' | 'node-vm-fallback';

/** Audit port — fire-and-forget. Throws are swallowed. */
export type SandboxAuditor = (event: SandboxAuditEvent) => void;

/** Hard caps. Kernel-wide invariants; callers cannot override these. */
export const MAX_CODE_BYTES = 5 * 1024; // 5 KB
export const MAX_TIMEOUT_MS = 5000;
export const DEFAULT_TIMEOUT_MS = 1000;
export const MAX_MEMORY_MB = 8;
export const DEFAULT_MEMORY_MB = 8;
export const MAX_RESULT_DEPTH = 8;
export const MAX_RESULT_KEYS_PER_OBJECT = 200;
export const MAX_RESULT_ARRAY_LEN = 1000;
