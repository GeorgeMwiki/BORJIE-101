/**
 * skill.admin.update_autonomy_policy — change the autonomy policy threshold
 * for a domain (maintenance, finance, comms, etc).
 *
 * High-impact change — ALWAYS returns PROPOSED so the user explicitly
 * confirms the new threshold before it takes effect.
 *
 * ─────────────────────────────────────────────────────────────────────
 * RSS-16 META-RAIL — the autonomy-controller can never relax its OWN
 * rails. This tool is the surface through which autonomy is *escalated*
 * per domain. A meta-rail (`assertNoProtectedRailEscalation`) hard-blocks
 * any escalation whose target — structured `domain` OR free-form `reason`
 * intent — names a PROTECTED prefix (money / licence / deletion /
 * policy-gate / kill-switch / four-eye). Those rails stay dual-control HITL
 * FOREVER: the controller may raise autonomy for ordinary actions but can
 * never grant itself authority over its gate / audit / test machinery.
 *
 * Properties of the meta-rail:
 *  - DETERMINISTIC, no-LLM, FAIL-CLOSED (any thrown error → block).
 *  - ADDITIVE: it only ADDS a prohibition; ordinary-domain escalations are
 *    untouched. No env flag — a safety rail is always on.
 *  - ESCALATION-ONLY: lowering autonomy toward `manual` over a protected
 *    prefix is harmless and is NEVER blocked; only RAISING is forbidden.
 *  - Belt-and-suspenders: derives the protected-target from BOTH the
 *    structured `domain` AND the free-form `reason` text, so a caller
 *    cannot smuggle "raise finance to full_auto so it bypasses the
 *    four-eye gate on money transfers" past a clean structured field.
 * ─────────────────────────────────────────────────────────────────────
 */

import { z } from 'zod';
import type { ToolHandler } from '../../orchestrator/tool-dispatcher.js';
import {
  assertSameTenant,
  committed,
  failed,
  proposed,
  safeParse,
} from './shared.js';

export const AutonomyDomainSchema = z.enum([
  'maintenance',
  'finance',
  'comms',
  'offtake',
  'compliance',
  'marketing',
  'hr',
]);
export type AutonomyDomain = z.infer<typeof AutonomyDomainSchema>;

export const AutonomyLevelSchema = z.enum(['manual', 'advise', 'propose', 'auto_within_policy', 'full_auto']);
export type AutonomyLevel = z.infer<typeof AutonomyLevelSchema>;

export const UpdateAutonomyPolicySchema = z.object({
  tenantId: z.string().min(1).optional(),
  domain: AutonomyDomainSchema,
  level: AutonomyLevelSchema,
  /** Hard cap on side-effect magnitude (KES) — enforced by autonomy engine. */
  costCeilingKes: z.number().nonnegative().optional(),
  /** Affected user ids (omit → org-wide). */
  appliesToUserIds: z.array(z.string().min(1)).max(500).optional(),
  reason: z.string().min(3).max(2_000),
  force: z.boolean().default(false),
});
export type UpdateAutonomyPolicyParams = z.infer<typeof UpdateAutonomyPolicySchema>;

export interface UpdateAutonomyPolicyResult {
  readonly domain: AutonomyDomain;
  readonly level: AutonomyLevel;
  readonly costCeilingKes?: number | undefined;
  readonly appliesToUserIds?: readonly string[] | undefined;
  readonly effectiveAt: string;
  readonly priorLevel?: AutonomyLevel | undefined;
}

// ─────────────────────────────────────────────────────────────────────
// RSS-16 META-RAIL — protected-prefix escalation guard.
// ─────────────────────────────────────────────────────────────────────

/**
 * Autonomy-level escalation lattice. Index = autonomy rank; HIGHER index =
 * MORE autonomy (less human control). `manual` is rank 0 (full HITL). A
 * change is an "escalation" iff it requests a rank strictly greater than
 * `manual` — i.e. it would grant the controller *any* self-acting authority
 * over the target. Lowering toward `manual` is never an escalation.
 */
const AUTONOMY_LEVEL_RANK: Readonly<Record<AutonomyLevel, number>> =
  Object.freeze({
    manual: 0,
    advise: 1,
    propose: 2,
    auto_within_policy: 3,
    full_auto: 4,
  });

/**
 * An escalation is any requested level above full human control (`manual`).
 * `manual` keeps the action fully gated, so targeting a protected prefix
 * with `manual` is harmless and must NOT be blocked (avoids false-blocking).
 */
function isEscalation(level: AutonomyLevel): boolean {
  return (AUTONOMY_LEVEL_RANK[level] ?? Number.POSITIVE_INFINITY) > AUTONOMY_LEVEL_RANK.manual;
}

/**
 * The PROTECTED prefixes the autonomy-controller can never grant itself
 * authority over. These map 1:1 to Borjie's inviolable rails: the money
 * path (LedgerService), licence/regulatory actions, irreversible deletion,
 * the policy-gate, the kill-switch, and the four-eye / dual-control gate —
 * plus the audit-chain and the meta-rail / test machinery that proves they
 * hold. Conservative + broad on purpose (fail-closed).
 */
const PROTECTED_RAIL_PATTERNS: ReadonlyArray<RegExp> = Object.freeze([
  // money path
  /\bmoney(?:[- ]?path)?\b/i,
  /\bledger(?:[- ]?service)?\b/i,
  /\bdouble[- ]?entry\b/i,
  /\bpayout\b/i,
  /\bdisburse(?:ment)?\b/i,
  /\bfund[- ]?transfer\b/i,
  /\bwire[- ]?transfer\b/i,
  // licence / regulatory
  /\blicen[cs]e\b/i,
  /\bpermit[- ]?suspen/i,
  /\bregulator(?:y)?[- ]?(?:action|filing|notice)\b/i,
  // deletion / irreversible
  /\bdeletion\b/i,
  /\bhard[- ]?delete\b/i,
  /\bpurge\b/i,
  /\bdestroy[- ]?(?:data|records?)\b/i,
  // policy-gate
  /\bpolicy[- ]?gate\b/i,
  // kill-switch
  /\bkill[- ]?switch\b/i,
  /\bkillswitch\b/i,
  // four-eye / dual-control
  /\bfour[- ]?eyes?\b/i,
  /\bdual[- ]?control\b/i,
  /\btwo[- ]?person\b/i,
  // audit / meta-rail / its own machinery
  /\baudit[- ]?(?:chain|trail|log)\b/i,
  /\bmeta[- ]?rail\b/i,
  /\binviolable\b/i,
  /\bautonomy[- ]?(?:gate|controller|guard|rail)\b/i,
]);

/**
 * Phrases that betray an intent to ROUTE AROUND / BYPASS / DISABLE a rail,
 * even when the rail name itself is paraphrased. The meta-rail derives the
 * prohibition from BOTH the structured target AND the free-form text so a
 * caller cannot launder a rail-relaxation through the `reason` field.
 */
const RAIL_BYPASS_PHRASES: ReadonlyArray<RegExp> = Object.freeze([
  /\bbypass(?:es|ing)?\b/i,
  /\bskip(?:s|ping)?\b/i,
  /\bdisabl(?:e|es|ing)\b/i,
  /\bwithout (?:approval|sign[- ]?off|review|the gate)\b/i,
  /\bno (?:approval|sign[- ]?off|human|review)\b/i,
  /\bself[- ]?(?:approve|authoris|authoriz)/i,
  /\bremove (?:the )?(?:gate|guard|rail|approval)/i,
  /\bgrant (?:itself|myself|the controller)\b/i,
  /\bover[- ]?ride (?:the )?(?:gate|guard|rail|approval|kill[- ]?switch)/i,
]);

function namesProtectedRail(text: string | undefined): boolean {
  if (!text) return false;
  return PROTECTED_RAIL_PATTERNS.some((re) => re.test(text));
}

function intendsRailBypass(text: string | undefined): boolean {
  if (!text) return false;
  return RAIL_BYPASS_PHRASES.some((re) => re.test(text));
}

export interface MetaRailVerdict {
  readonly blocked: boolean;
  readonly reason?: string;
}

/**
 * The meta-rail. DETERMINISTIC, no-LLM, FAIL-CLOSED. Returns `blocked:true`
 * for any autonomy *escalation* (level above `manual`) that targets — by
 * structured `domain` or by free-form `reason` — a protected rail, or whose
 * `reason` betrays an intent to route around / disable a rail. Returns
 * `blocked:false` for ordinary-domain escalations and for any de-escalation
 * toward `manual` (so it can never false-block normal controller use).
 *
 * Note: today's `domain` enum holds only ordinary business domains, so the
 * structured branch is a forward-guard for any future protected domain; the
 * `reason`-text branch is what blocks the real attack — "raise X so it
 * bypasses the four-eye gate on money transfers" — here and now.
 */
export function assertNoProtectedRailEscalation(
  domain: AutonomyDomain,
  level: AutonomyLevel,
  reason: string,
): MetaRailVerdict {
  try {
    // De-escalations (and explicit full-HITL `manual`) are always safe —
    // they only ADD human control, never remove it.
    if (!isEscalation(level)) {
      return { blocked: false };
    }

    const structuredHit = namesProtectedRail(domain);
    const reasonNamesRail = namesProtectedRail(reason);
    const reasonBypassIntent = intendsRailBypass(reason);

    // Block when the escalation TARGETS a protected rail (by domain or by
    // reason text), OR when the reason expresses intent to route around a
    // rail while escalating. The bypass-intent branch fires even if the
    // specific rail name is paraphrased — escalating autonomy *in order to*
    // skip approval is itself the forbidden act.
    if (structuredHit || reasonNamesRail || reasonBypassIntent) {
      return {
        blocked: true,
        reason:
          'meta_rail_protected_escalation_blocked: the autonomy controller ' +
          'cannot raise autonomy over money / licence / deletion / ' +
          'policy-gate / kill-switch / four-eye rails — these stay ' +
          'dual-control (human-in-the-loop) by inviolable rule, regardless ' +
          'of posture or force flag.',
      };
    }

    return { blocked: false };
  } catch {
    // Any unexpected error fails closed — the meta-rail NEVER lets an
    // escalation through on ambiguity.
    return {
      blocked: true,
      reason: 'meta_rail_evaluation_failed: blocked fail-closed.',
    };
  }
}

export const updateAutonomyPolicyTool: ToolHandler = {
  name: 'skill.admin.update_autonomy_policy',
  description:
    'Update autonomy policy for a domain (maintenance/finance/comms/leasing/compliance/marketing/hr). ALWAYS returns a PROPOSED action so the user explicitly confirms — autonomy policy is org-wide and high-impact.',
  parameters: {
    type: 'object',
    required: ['domain', 'level', 'reason'],
    properties: {
      tenantId: { type: 'string' },
      domain: {
        type: 'string',
        enum: ['maintenance', 'finance', 'comms', 'offtake', 'compliance', 'marketing', 'hr'],
      },
      level: {
        type: 'string',
        enum: ['manual', 'advise', 'propose', 'auto_within_policy', 'full_auto'],
      },
      costCeilingKes: { type: 'number' },
      appliesToUserIds: { type: 'array', items: { type: 'string' } },
      reason: { type: 'string' },
      force: { type: 'boolean' },
    },
  },
  async execute(params, context) {
    const parsed = safeParse(UpdateAutonomyPolicySchema, params);
    if (!parsed.ok) return failed(parsed.error);

    const iso = assertSameTenant(context, parsed.data.tenantId);
    if (iso) return failed(iso);

    // RSS-16 META-RAIL — runs BEFORE the PROPOSED/force branch so a
    // protected-rail escalation can never reach even the proposal stage,
    // regardless of `force`. This is the one prohibition the controller
    // can never override.
    const metaRail = assertNoProtectedRailEscalation(
      parsed.data.domain,
      parsed.data.level,
      parsed.data.reason,
    );
    if (metaRail.blocked) {
      return failed(metaRail.reason ?? 'meta_rail_protected_escalation_blocked');
    }

    const result: UpdateAutonomyPolicyResult = {
      domain: parsed.data.domain,
      level: parsed.data.level,
      costCeilingKes: parsed.data.costCeilingKes,
      appliesToUserIds: parsed.data.appliesToUserIds,
      effectiveAt: new Date().toISOString(),
    };

    if (!parsed.data.force) {
      return proposed(
        result,
        `Set ${result.domain} autonomy → ${result.level}${
          result.costCeilingKes ? ` (ceiling KES ${result.costCeilingKes.toLocaleString()})` : ''
        } — awaiting confirmation`
      );
    }
    return committed(
      result,
      `Autonomy ${result.domain} set to ${result.level}${
        result.costCeilingKes ? ` (ceiling KES ${result.costCeilingKes.toLocaleString()})` : ''
      }`
    );
  },
};
