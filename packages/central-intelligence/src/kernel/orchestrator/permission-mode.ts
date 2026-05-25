/**
 * Permission mode — Claude-Code-style operator switch that broadens or
 * narrows what the orchestrator will do without owner approval.
 *
 * Six modes mirror the official Claude Code surface:
 *
 *   - `default`              — ask owner for mutate/destroy/billing tiers,
 *                              auto-allow `read`.
 *   - `accept-edits`         — auto-allow read + mutate, still ask before
 *                              destroy/billing/external-comm.
 *   - `plan`                 — PLAN MODE. Reads still run; every mutate
 *                              short-circuits to a "would-do" preview the
 *                              MD renders as a DiffView block. The tool is
 *                              NEVER actually invoked.
 *   - `auto`                 — auto for all tiers up to the autonomy cap;
 *                              the autonomy-governance layer still gets
 *                              the call but the user-facing ask-owner gate
 *                              is bypassed.
 *   - `dont-ask`             — never prompt owner (Klarna-style aggressive
 *                              autonomy — for batch / RPA flows). Hooks
 *                              that would ask are converted to deny so a
 *                              caller-controlled retry can decide.
 *   - `bypass-permissions`   — dangerous; mirrors `--dangerously-skip-
 *                              permissions`. Skips ALL permission hooks
 *                              but still logs a warning + an audit row to
 *                              the sovereign ledger.
 *
 * The pure evaluator `evaluatePermissionMode(ctx, action)` returns one
 * of `allow | ask | deny | plan-preview` so the main-loop can take the
 * appropriate branch BEFORE running the pre-tool-use hook chain.
 */

import type { RiskTier } from '../risk-tier.js';

// ─────────────────────────────────────────────────────────────────────
// Mode enum + evaluator
// ─────────────────────────────────────────────────────────────────────

export type PermissionMode =
  | 'default'
  | 'accept-edits'
  | 'plan'
  | 'auto'
  | 'dont-ask'
  | 'bypass-permissions';

export const PERMISSION_MODES: ReadonlyArray<PermissionMode> = Object.freeze([
  'default',
  'accept-edits',
  'plan',
  'auto',
  'dont-ask',
  'bypass-permissions',
]);

export interface PermissionModeContext {
  readonly currentMode: PermissionMode;
  /** Optional tenant-scoped override; when set takes precedence. */
  readonly tenantOverride?: PermissionMode;
  readonly callerScopes: ReadonlyArray<string>;
}

export interface PermissionAction {
  readonly riskTier: RiskTier;
  /** Optional sub-MD persona — irrelevant for permission, kept for telemetry. */
  readonly subMd?: string;
}

export interface PermissionEvaluation {
  readonly decision: 'allow' | 'ask' | 'deny' | 'plan-preview';
  readonly reason?: string;
}

/**
 * Pure evaluator. Order of precedence:
 *
 *   1. `bypass-permissions` short-circuits to allow with a logged warning.
 *   2. `plan` short-circuits to plan-preview for any non-read tier.
 *   3. `dont-ask` short-circuits to deny when a tier would otherwise ask.
 *   4. `auto` allows up to + including external-comm.
 *   5. `accept-edits` allows up to + including mutate.
 *   6. `default` allows read only.
 *
 * The tenantOverride wins when set so a tenant can lock down or open up
 * regardless of the platform-default mode.
 */
export function evaluatePermissionMode(
  ctx: PermissionModeContext,
  action: PermissionAction,
): PermissionEvaluation {
  const mode = ctx.tenantOverride ?? ctx.currentMode;
  const tier = action.riskTier;

  if (mode === 'bypass-permissions') {
    return { decision: 'allow', reason: 'bypass-permissions' };
  }

  if (mode === 'plan') {
    if (tier === 'read') {
      return { decision: 'allow', reason: 'plan-mode-read-passthrough' };
    }
    return { decision: 'plan-preview', reason: 'plan-mode-short-circuit' };
  }

  if (mode === 'auto') {
    return { decision: 'allow', reason: 'auto-mode' };
  }

  if (mode === 'accept-edits') {
    if (tier === 'read' || tier === 'mutate') {
      return { decision: 'allow', reason: 'accept-edits' };
    }
    return { decision: 'ask', reason: 'accept-edits-elevated-tier' };
  }

  if (mode === 'dont-ask') {
    if (tier === 'read') {
      return { decision: 'allow', reason: 'dont-ask-read' };
    }
    return { decision: 'deny', reason: 'dont-ask-would-prompt' };
  }

  // `default`
  if (tier === 'read') {
    return { decision: 'allow', reason: 'default-read' };
  }
  return { decision: 'ask', reason: 'default-elevated-tier' };
}

// ─────────────────────────────────────────────────────────────────────
// Plan-mode preview rendering — the main-loop uses this to synthesise
// a "would-do" preview when `decision === 'plan-preview'`. The result is
// a string the MD includes in its response, typically formatted as a
// DiffView UiPart block by downstream renderers.
// ─────────────────────────────────────────────────────────────────────

export interface PlanModePreviewInput {
  readonly toolName: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly riskTier: RiskTier;
}

export function renderPlanModePreview(input: PlanModePreviewInput): string {
  const lines = [
    `[plan-mode preview — tool NOT executed]`,
    `tool: ${input.toolName}`,
    `risk: ${input.riskTier}`,
    `inputs:`,
    ...Object.entries(input.inputs).map(([k, v]) => `  - ${k}: ${stringify(v)}`),
  ];
  return lines.join('\n');
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return '[unserialisable]';
  }
}
