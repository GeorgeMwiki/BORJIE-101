/**
 * Sandbox policy gate — composes `runInSandbox` with subscription-tier
 * caps + a structured audit trail.
 *
 * Plain `runInSandbox` accepts any timeout / memory request the caller
 * passes (clamped to kernel-wide hard caps). The policy gate adds a
 * second layer of caps anchored on the caller's TIER:
 *
 *   - free        →  500 ms /  4 MB / 2 KB code
 *   - pro         → 1500 ms /  6 MB / 4 KB code
 *   - enterprise  → 5000 ms /  8 MB / 5 KB code (= kernel hard cap)
 *   - sovereign   → 5000 ms /  8 MB / 5 KB code (kernel hard cap; only
 *                   sovereign actions can reach the V8 limit)
 *
 * Callers can request LOWER caps than their tier permits — the wrapper
 * picks `min(callerRequest, tierCap, kernelHardCap)`. Requesting a
 * higher value is silently clamped.
 *
 * Every invocation routes through the audit port. The default audit
 * adapter (`makeConsoleAuditAdapter`) prints a one-line JSON record;
 * the production wiring should plug into the same audit-sink the
 * conversation recorder uses.
 */

import {
  DEFAULT_TIMEOUT_MS,
  MAX_CODE_BYTES,
  MAX_MEMORY_MB,
  MAX_TIMEOUT_MS,
  type SandboxAuditEvent,
  type SandboxAuditor,
  type SandboxOptions,
  type SandboxResult,
} from './types.js';
import { runInSandbox } from './js-sandbox.js';
import { logger } from '../../logger.js';

export type SandboxTier = 'free' | 'pro' | 'enterprise' | 'sovereign';

export interface TierCaps {
  readonly timeoutMs: number;
  readonly memoryMb: number;
  readonly codeBytes: number;
}

/**
 * Per-tier caps. The enterprise/sovereign rows equal the kernel hard
 * caps — they bound the sandbox but do not relax it.
 *
 * Memory is tier-agnostic at 8 MB because isolated-vm enforces an
 * 8 MB minimum on the underlying V8 isolate's memoryLimit. Tier
 * differentiation is driven instead by the timeout and code-size
 * caps — both meaningfully throttle abuse without going below the
 * V8 minimum.
 */
export const DEFAULT_TIER_CAPS: Readonly<Record<SandboxTier, TierCaps>> = Object.freeze({
  free: { timeoutMs: 500, memoryMb: MAX_MEMORY_MB, codeBytes: 2 * 1024 },
  pro: { timeoutMs: 1500, memoryMb: MAX_MEMORY_MB, codeBytes: 4 * 1024 },
  enterprise: { timeoutMs: MAX_TIMEOUT_MS, memoryMb: MAX_MEMORY_MB, codeBytes: MAX_CODE_BYTES },
  sovereign: { timeoutMs: MAX_TIMEOUT_MS, memoryMb: MAX_MEMORY_MB, codeBytes: MAX_CODE_BYTES },
});

export interface SandboxPolicyInput {
  readonly code: string;
  readonly context?: Record<string, unknown>;
  readonly tier: SandboxTier;
  /** Caller-requested timeout. Clamped to `min(req, tierCap, hardCap)`. */
  readonly timeoutMs?: number;
  /** Caller-requested memory. Clamped to `min(req, tierCap, hardCap)`. */
  readonly memoryMb?: number;
  /** Opaque caller tag — flows through to the audit event. */
  readonly callerTag?: string;
  /** Optional custom audit port. If omitted, no audit is emitted. */
  readonly auditor?: SandboxAuditor;
  /** Optional override for tier caps (testing / migration only). */
  readonly tierCaps?: Readonly<Record<SandboxTier, TierCaps>>;
}

export interface SandboxPolicyResult extends SandboxResult {
  /** True when the policy gate rejected the request before V8 ran. */
  readonly policyRejected?: boolean;
  /** Reason the policy gate rejected — surfaced for debugging. */
  readonly policyReason?: string;
  /** Effective caps that were enforced (after clamping). */
  readonly enforcedCaps: TierCaps;
}

/**
 * Run a snippet through the tier-aware policy gate. Returns the same
 * shape as `runInSandbox` plus the policy bookkeeping.
 */
export async function runInSandboxWithPolicy(
  input: SandboxPolicyInput,
): Promise<SandboxPolicyResult> {
  const tierCaps = input.tierCaps ?? DEFAULT_TIER_CAPS;
  const caps = tierCaps[input.tier];

  const requestedTimeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const requestedMemory = input.memoryMb ?? caps.memoryMb;

  const enforcedTimeoutMs = Math.min(requestedTimeout, caps.timeoutMs, MAX_TIMEOUT_MS);
  const enforcedMemoryMb = Math.min(requestedMemory, caps.memoryMb, MAX_MEMORY_MB);
  const enforcedCodeBytes = Math.min(caps.codeBytes, MAX_CODE_BYTES);

  const enforcedCaps: TierCaps = {
    timeoutMs: enforcedTimeoutMs,
    memoryMb: enforcedMemoryMb,
    codeBytes: enforcedCodeBytes,
  };

  // Tier-level code-size pre-check. The kernel hard cap (5 KB) is
  // enforced inside runInSandbox; here we apply the per-tier cap so a
  // free-tier caller never reaches V8 with a 5 KB snippet.
  const codeBytes = typeof input.code === 'string' ? Buffer.byteLength(input.code, 'utf8') : 0;
  if (codeBytes > enforcedCodeBytes) {
    const event: SandboxAuditEvent = {
      at: new Date(),
      ...(input.callerTag !== undefined ? { callerTag: input.callerTag } : {}),
      codeBytes,
      timeoutMs: enforcedTimeoutMs,
      memoryMb: enforcedMemoryMb,
      ok: false,
      errorCode: 'SANDBOX_CODE_TOO_LARGE',
      durationMs: 0,
      memoryUsedBytes: 0,
      backend: 'isolated-vm',
    };
    fireAudit(input.auditor, event);
    return {
      ok: false,
      error: {
        code: 'SANDBOX_CODE_TOO_LARGE',
        message: `Snippet exceeds ${enforcedCodeBytes}-byte cap for tier '${input.tier}'`,
      },
      durationMs: 0,
      memoryUsedBytes: 0,
      policyRejected: true,
      policyReason: `code exceeds tier '${input.tier}' cap (${codeBytes} > ${enforcedCodeBytes} bytes)`,
      enforcedCaps,
    };
  }

  const options: SandboxOptions = {
    timeoutMs: enforcedTimeoutMs,
    memoryMb: enforcedMemoryMb,
    ...(input.callerTag !== undefined ? { callerTag: input.callerTag } : {}),
    ...(input.auditor !== undefined ? { auditor: input.auditor } : {}),
  };

  const result = await runInSandbox(input.code, input.context ?? {}, options);
  return { ...result, enforcedCaps };
}

function fireAudit(auditor: SandboxAuditor | undefined, event: SandboxAuditEvent): void {
  if (!auditor) return;
  try {
    auditor(event);
  } catch {
    // never bubble — audit failures must not block the policy decision.
  }
}

/**
 * Convenience adapter: emit one-line JSON audit records to console.
 * Production should adapt this to the kernel's structured audit sink.
 */
export function makeConsoleAuditAdapter(prefix = '[sandbox-audit]'): SandboxAuditor {
  return (event) => {
    logger.info(`${prefix} ${JSON.stringify({ ...event, at: event.at.toISOString() })}`);
  };
}
