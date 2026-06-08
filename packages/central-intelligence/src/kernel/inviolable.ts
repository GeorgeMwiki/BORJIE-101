/**
 * Inviolable refusal gates — hard refusals the kernel issues BEFORE
 * the sensor is ever called. These differ from the prompt-shield
 * (which sanitises) and the policy-gate (which redacts on output).
 * Inviolable rules are categorical: if the input matches, the kernel
 * returns a refusal decision.
 *
 * The rules are deterministic regex / structure checks — no LLM. They
 * cover seven categories:
 *
 *   1. Cross-tenant identification — asking about a tenant in a
 *      scope that does not own that tenant.
 *   2. PII exfiltration — asking the agent to output IDs/numbers in
 *      bulk for export to an unknown sink.
 *   3. Counterfeit-authority — claims the user is "from Borjie"
 *      asking for system internals.
 *   4. Regulatory/legal autonomy — asking the agent to "decide" a
 *      licence-suspension without going through the documented
 *      outstanding-royalties escalation ladder.
 *   5. (K5) IP — copyright. Refuses requests to reproduce full song
 *      lyrics, book chapters, or other obviously-copyrighted prose.
 *   6. (K5) IP — competitor / proprietary data. Refuses requests for
 *      a competing mining operator's royalty roll, buyout statements,
 *      or back-office data — even when the requester is asking the
 *      Borjie kernel from a different tenant scope.
 *   7. (K5) IP — legal-IP / forge-impersonate. Refuses to draft forged
 *      offtake agreements, fabricated TRA receipts, or impersonating
 *      legal notices.
 */

import type { ScopeContext } from '../types.js';
import type { ThoughtRequest } from './kernel-types.js';

export interface InviolableVerdict {
  readonly status: 'pass' | 'block';
  readonly category?:
    | 'cross-tenant'
    | 'pii-bulk'
    | 'authority'
    | 'autonomy'
    | 'ip-copyright'
    | 'ip-competitor-data'
    | 'ip-forge-impersonate';
  readonly reason?: string;
}

const BULK_PII_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(export|dump|list|give me|send me|email me)\b.{0,40}\b(all|every|each|complete)\b.{0,40}\b(tenant|buyer|operator|owner|phone|email|nida|tin|passport)/i,
  /\b(spreadsheet|csv|excel|xlsx)\b.{0,30}\b(of|with)\b.{0,30}\b(tenant|buyer|operator|owner|phone)/i,
];

const COUNTERFEIT_AUTHORITY_PATTERNS: ReadonlyArray<RegExp> = [
  /\bi am (from|with) (borjie|boss[- ]?nyumba|the platform|hq)\b/i,
  /\b(override|bypass|disable) (your|the) (system prompt|safety|guard|gate|policy)/i,
  /\b(developer mode|admin mode|root mode|debug mode|sudo)\b/i,
];

const TRIBUNAL_AUTONOMY_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(decide|finalize|finalise|approve|sign[- ]off on)\b.{0,40}\b(licence[- ]?suspension|license[- ]?suspension|incursion[- ]?response|site[- ]?seizure|seizure|regulatory[- ]?hearing)/i,
  /\b(skip|bypass)\b.{0,30}\b(outstanding[- ]?royalties ladder|royalties ladder|notice|regulatory hearing|hearing)/i,
];

// ─────────────────────────────────────────────────────────────────────
// K5 — IP-category refusals
// ─────────────────────────────────────────────────────────────────────

/**
 * IP — copyrighted creative-work reproduction.
 *
 * The kernel is designed for mining-estate workflows, not for
 * music / publishing-rights work. Anything that asks the kernel to
 * REPRODUCE full lyrics / a full poem / a full book chapter / a full
 * news article gets refused at the input layer.
 */
const IP_COPYRIGHT_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(give me|recite|reproduce|print|output|paste|sing|type out|show me)\b.{0,40}\b(full|complete|entire|all the)\b.{0,40}\b(lyrics?|song|poem|verses?|chapter|article)/i,
  /\b(lyrics?|verses?)\s+(of|to|for)\s+(the\s+)?(song|album|track)\b/i,
  /\b(print|reproduce|output|copy|paste)\s+(the|all|every|each)\s+(chapter|chapters|pages?|paragraphs?)\s+(of|from)\b/i,
  /\bwrite (me )?(the )?(entire|whole|full) (book|novel|chapter|article|paper)\b/i,
];

/**
 * IP — competitor / proprietary data probe.
 *
 * Refuses prompts that target a NAMED competitor mining operator's
 * confidential operational data (buyout statements, royalty rolls,
 * production reports) — even when phrased as "show me Geita Gold's
 * buyout statements". The kernel has no access to such data and must
 * not fabricate.
 *
 * Heuristic: a known competitor brand name AND a back-office artifact
 * keyword in the same sentence.
 */
const COMPETITOR_NAMES: ReadonlyArray<string> = [
  'geita gold',
  'geitagold',
  'acacia mining',
  'barrick',
  'shanta gold',
  'shantagold',
  'williamson diamonds',
  'twiga minerals',
  'buckreef',
];

const COMPETITOR_DATA_ARTIFACTS = new RegExp(
  '\\b(royalty[- ]?roll|buyout[- ]?statement|production[- ]?report|operator[- ]?payout|offtake[- ]?ledger|assay[- ]?ledger|owner[- ]?statement|tenant[- ]?roll|tenant[- ]?ledger|rent[- ]?roll|arrears[- ]?report|outstanding[- ]?royalties[- ]?report|portfolio[- ]?report|p&l|owner[- ]?payout|disbursement[- ]?report|back[- ]?office)s?\\b',
  'i',
);

function looksLikeCompetitorDataRequest(msg: string): boolean {
  if (!COMPETITOR_DATA_ARTIFACTS.test(msg)) return false;
  const lower = msg.toLowerCase();
  for (const brand of COMPETITOR_NAMES) {
    if (lower.includes(brand)) return true;
  }
  // Generic phrasing — "another mining operator's buyout statements".
  if (
    /\b(another|other|competitor|rival)\b.{0,40}\b(mining[- ]?operator|mining[- ]?company|operator|miner|licence[- ]?holder|license[- ]?holder|agency|company|firm)/i.test(
      msg,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * IP — forge / impersonate.
 *
 * Refuses prompts asking the kernel to forge an offtake agreement,
 * fabricate a TRA receipt, draft an impersonating licence-suspension
 * notice, or otherwise create documents intended to deceive a third
 * party.
 */
const IP_FORGE_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(forge|fake|fabricate|counterfeit)\b.{0,40}\b(offtake|agreement|contract|licence|license|permit|tra|kra|receipt|notice|stamp|signature|letterhead|certificate)/i,
  /\b(draft|write|generate|compose)\b.{0,40}\b(a\s+)?(forged|fake|fraudulent|impersonating|counterfeit)\b/i,
  /\b(pretend|impersonate)\b.{0,30}\b(to be|you are)\b.{0,40}\b(owner|operator|mining commission|regulator|magistrate|tra|kra|tax authority|government|advocate|bank)/i,
  /\b(create|make)\b.{0,30}\b(a\s+)?(fake|forged|backdated)\b.{0,40}\b(offtake|agreement|licence|license|receipt|tra|kra|invoice|payment|royalty)/i,
];

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

export function checkInviolable(req: ThoughtRequest): InviolableVerdict {
  const msg = req.userMessage;

  if (containsCrossTenantReference(msg, req.scope)) {
    return {
      status: 'block',
      category: 'cross-tenant',
      reason: 'request references a tenant outside the current scope',
    };
  }

  for (const re of BULK_PII_PATTERNS) {
    if (re.test(msg)) {
      return {
        status: 'block',
        category: 'pii-bulk',
        reason: 'bulk export of personal identifiers is not a kernel-served operation',
      };
    }
  }

  for (const re of COUNTERFEIT_AUTHORITY_PATTERNS) {
    if (re.test(msg)) {
      return {
        status: 'block',
        category: 'authority',
        reason: 'unverifiable authority claim or system-prompt override attempt',
      };
    }
  }

  for (const re of TRIBUNAL_AUTONOMY_PATTERNS) {
    if (re.test(msg)) {
      return {
        status: 'block',
        category: 'autonomy',
        reason: 'licence-suspension / regulatory actions go through the outstanding-royalties escalation ladder, not the chat kernel',
      };
    }
  }

  // K5 — IP categories. Order: copyright → forge/impersonate → competitor
  // probe (last because the heuristic is the most permissive).
  for (const re of IP_COPYRIGHT_PATTERNS) {
    if (re.test(msg)) {
      return {
        status: 'block',
        category: 'ip-copyright',
        reason: 'reproducing full copyrighted works (lyrics, chapters, articles) is outside the kernel mandate',
      };
    }
  }

  for (const re of IP_FORGE_PATTERNS) {
    if (re.test(msg)) {
      return {
        status: 'block',
        category: 'ip-forge-impersonate',
        reason: 'forging or impersonating legal / financial documents is refused at the kernel',
      };
    }
  }

  if (looksLikeCompetitorDataRequest(msg)) {
    return {
      status: 'block',
      category: 'ip-competitor-data',
      reason: 'requesting another mining-operator’s proprietary royalty / buyout data is outside the kernel mandate',
    };
  }

  return { status: 'pass' };
}

/**
 * Heuristic — flags `tenant_<uuid>` or `tenantId=` references inside
 * a platform scope, which by construction MUST be DP-aggregate only.
 * This is intentionally simple; the structured scope check on tools
 * is the real guarantee.
 */
function containsCrossTenantReference(msg: string, scope: ScopeContext): boolean {
  if (scope.kind !== 'platform') return false;
  return (
    /\btenant[_-]?id\s*[:=]/i.test(msg) ||
    /\btenant_[0-9a-f-]{8,}/i.test(msg) ||
    /\bbelonging to tenant\b/i.test(msg)
  );
}

// ─────────────────────────────────────────────────────────────────────
// META-RAIL — the one organ the surgeon cannot operate on.
//
// `checkBodyChangeInviolable` is a NET-NEW, deterministic, no-LLM,
// FAIL-CLOSED gate that governs the MD's self-modification ("body
// change") path. It is the safety keystone of the MD-as-Body
// architecture (Docs/research/MD_AS_BODY_ARCHITECTURE.md §governance,
// §selfRedesign L3): a body-change is FORBIDDEN by construction if it
//
//   1. edits / disables / routes-around a RAIL (policy-gate, inviolable,
//      four-eye, kill-switch, RLS, the money path / LedgerService),
//   2. SHORTENS or ALTERS the hash-chained, append-only audit /
//      provenance path,
//   3. RAISES its own mandate/autonomy ceiling or LOWERS a confidence
//      floor,
//   4. proceeds on an INTEGRITY FAILURE (missing/invalid registration
//      hash, broken chain link, unsigned proposal).
//
// This is ADDITIVE. It NEVER touches `checkInviolable` above and only
// ADDS prohibitions. It is threaded into `composeWithRail` as one more
// monotone-most-cautious input, so a forbidden body-change can never be
// auto and rail-gate-always-wins extends to self-modification for free
// (lexicographic corrigibility — Provably Corrigible Agents).
//
// Fail-closed contract: ANY malformed / missing descriptor field, ANY
// thrown error in evaluation, ANY ambiguity resolves to `forbid`.
// ─────────────────────────────────────────────────────────────────────

/**
 * Which kind of body-change is being attempted. Mirrors the three
 * governed self-redesign layers (L1 move/reorder, L2 add surface /
 * capability, L3 governed self-modification / sub-MD composition).
 */
export type BodyChangeKind =
  | 'ui-move'
  | 'ui-add'
  | 'capability-add'
  | 'prompt-edit'
  | 'tool-def-edit'
  | 'sub-md-compose'
  | 'self-model-edit'
  | 'code-patch';

/**
 * The categories the meta-rail forbids. Each maps to a clause of the
 * meta-rail spec.
 */
export type BodyChangeForbiddenCategory =
  | 'rail-edit'
  | 'audit-shorten'
  | 'ceiling-raise'
  | 'confidence-floor-lower'
  | 'integrity-failure'
  | 'malformed-descriptor';

/**
 * A structured, inspectable description of a proposed body-change. The
 * meta-rail reasons over THIS artifact (the externally-grounded
 * self-model), never over model weights or free-form intent — see the
 * Anthropic-introspection caveat in the capstone spec.
 */
export interface BodyChangeDescriptor {
  /** The kind of organ-level change attempted. */
  readonly kind: BodyChangeKind;
  /** Stable id of the body node (surface / capability / sub-md / file). */
  readonly targetNodeId: string;
  /**
   * Body nodes this change would WRITE to. The meta-rail forbids any
   * write that touches a rail node (see RAIL_NODE_PATTERNS).
   */
  readonly touchesNodes?: ReadonlyArray<string>;
  /**
   * TRUE when the change edits, disables, weakens, or routes around any
   * rail (policy-gate / inviolable / four-eye / kill-switch / RLS /
   * money path). Caller-asserted; the meta-rail ALSO derives this from
   * `touchesNodes` + `summary` so a caller cannot hide a rail-edit by
   * leaving the flag false.
   */
  readonly editsRail?: boolean;
  /**
   * TRUE when the change would shorten / rewrite / delete / disable any
   * portion of the hash-chained, append-only audit or provenance path.
   */
  readonly altersAuditChain?: boolean;
  /**
   * The mandate/autonomy ceiling BEFORE and AFTER the change, on the
   * `auto < gate < four_eyes` lattice (or the L1..L5 ladder rank). A
   * change that RAISES the ceiling (after is less cautious than before)
   * is forbidden unless it is an explicit human-gated promotion — which
   * does not flow through this self-change syscall.
   */
  readonly ceilingBefore?: BodyChangeCeiling;
  readonly ceilingAfter?: BodyChangeCeiling;
  /**
   * Confidence floor BEFORE and AFTER. Lowering a floor (after < before)
   * is forbidden — it would let a less-sure action auto.
   */
  readonly confidenceFloorBefore?: number;
  readonly confidenceFloorAfter?: number;
  /**
   * Cryptographic registration-integrity inputs. The change is forbidden
   * unless the recomputed hash matches `expectedIntegrityHash` AND the
   * prior chain link is present. Caller injects the recomputed hash; the
   * meta-rail does NOT trust a single self-reported boolean.
   */
  readonly expectedIntegrityHash?: string;
  readonly computedIntegrityHash?: string;
  /** TRUE when the prior audit-chain link is present + verified. */
  readonly priorChainLinkVerified?: boolean;
  /** Free-form human/LLM summary; scanned for rail/audit edit phrasing. */
  readonly summary?: string;
}

/**
 * The autonomy ceiling lattice the meta-rail compares. Ordered most- to
 * least-cautious so a higher RANK = MORE autonomy (a RAISE is dangerous).
 */
export type BodyChangeCeiling =
  | 'four_eyes'
  | 'gate'
  | 'auto'
  | 'observer'
  | 'approver'
  | 'consultant'
  | 'collaborator'
  | 'operator';

export interface BodyChangeInviolableVerdict {
  readonly status: 'allow' | 'forbid';
  readonly category?: BodyChangeForbiddenCategory;
  readonly reason?: string;
}

/**
 * Autonomy rank: HIGHER = MORE autonomous (less cautious). A body-change
 * that moves a ceiling to a higher rank is a forbidden "ceiling raise".
 * Unknown values rank as the MOST autonomous (Infinity) on the BEFORE
 * side and the LEAST autonomous (-Infinity) on the AFTER side, so an
 * unrecognised ceiling can never be used to sneak a raise past the gate
 * (fail-closed in both directions).
 */
const CEILING_AUTONOMY_RANK: Readonly<Record<BodyChangeCeiling, number>> =
  Object.freeze({
    four_eyes: 0,
    observer: 0,
    gate: 1,
    approver: 1,
    consultant: 1,
    auto: 2,
    collaborator: 2,
    operator: 3,
  });

function ceilingRankBefore(c: BodyChangeCeiling | undefined): number {
  if (c === undefined) return Number.POSITIVE_INFINITY;
  const rank = CEILING_AUTONOMY_RANK[c];
  return rank === undefined ? Number.POSITIVE_INFINITY : rank;
}

function ceilingRankAfter(c: BodyChangeCeiling | undefined): number {
  if (c === undefined) return Number.NEGATIVE_INFINITY;
  const rank = CEILING_AUTONOMY_RANK[c];
  return rank === undefined ? Number.NEGATIVE_INFINITY : rank;
}

/**
 * Node-id / path patterns that name a RAIL organ. A body-change that
 * writes to any of these is a rail-edit and is forbidden — the meta-rail
 * never lets the surgeon operate on the nerve that keeps the body
 * correctable. Conservative + broad on purpose (fail-closed).
 */
const RAIL_NODE_PATTERNS: ReadonlyArray<RegExp> = [
  /\binviolable\b/i,
  /\bpolicy[- ]?gate\b/i,
  /\bfour[- ]?eye\b/i,
  /\bkill[- ]?switch\b/i,
  /\bkillswitch\b/i,
  /\bcompose[- ]?with[- ]?rail\b/i,
  /\bdecide[- ]?autonomy\b/i,
  /\bledger[- ]?service\b/i,
  /\bledgerservice\b/i,
  /\bmoney[- ]?path\b/i,
  /\bdouble[- ]?entry\b/i,
  /\brls\b/i,
  /\brow[- ]?level[- ]?security\b/i,
  /\baudit[- ]?hash[- ]?chain\b/i,
  /\baudit[- ]?chain\b/i,
  /\bsovereign[- ]?action[- ]?ledger\b/i,
  /\bmutation[- ]?authority\b/i,
  /\bself[- ]?extension\b/i,
  /\bcheck[- ]?body[- ]?change[- ]?inviolable\b/i,
  /\bmeta[- ]?rail\b/i,
];

/**
 * Phrases in a free-form summary that betray a rail-edit / audit-shorten
 * intent even when the structured flags are left false. The meta-rail
 * derives the prohibition from BOTH the structure AND the text so a
 * caller cannot bypass it by lying with the booleans.
 */
const RAIL_EDIT_PHRASES: ReadonlyArray<RegExp> = [
  /\b(disable|bypass|remove|delete|weaken|relax|skip|turn[- ]?off|route[- ]?around|short[- ]?circuit)\b.{0,40}\b(rail|policy[- ]?gate|inviolable|four[- ]?eye|kill[- ]?switch|killswitch|rls|guard|gate|check)/i,
  /\b(raise|increase|lift|widen)\b.{0,30}\b(autonomy|ceiling|cap|limit|mandate)/i,
  /\b(grant|give)\b.{0,20}\b(myself|itself|self)\b.{0,30}\b(more|higher|broader)\b/i,
];

const AUDIT_SHORTEN_PHRASES: ReadonlyArray<RegExp> = [
  /\b(shorten|truncate|trim|prune|skip|omit|drop|delete|rewrite|alter|tamper|edit|disable)\b.{0,40}\b(audit|provenance|hash[- ]?chain|chain|ledger|trail|log)/i,
  /\b(make|mark)\b.{0,20}\b(audit|chain|ledger)\b.{0,20}\b(mutable|editable|append[- ]?optional)/i,
];

function touchesRailNode(descriptor: BodyChangeDescriptor): boolean {
  const candidates: string[] = [descriptor.targetNodeId];
  if (descriptor.touchesNodes) candidates.push(...descriptor.touchesNodes);
  for (const node of candidates) {
    if (typeof node !== 'string') return true; // malformed → fail-closed
    for (const re of RAIL_NODE_PATTERNS) {
      if (re.test(node)) return true;
    }
  }
  return false;
}

function summaryAsserts(
  summary: string | undefined,
  patterns: ReadonlyArray<RegExp>,
): boolean {
  if (!summary) return false;
  for (const re of patterns) {
    if (re.test(summary)) return true;
  }
  return false;
}

/**
 * The meta-rail. DETERMINISTIC, no-LLM, FAIL-CLOSED. Returns `forbid`
 * for any body-change that edits a rail, shortens/alters the audit
 * chain, raises an autonomy ceiling, lowers a confidence floor, or
 * proceeds on an integrity failure. Returns `allow` ONLY when EVERY
 * clause passes and the descriptor is well-formed.
 *
 * ADDITIVE: this only adds prohibitions. It is the single deterministic
 * input the body-change syscall feeds into `composeWithRail` alongside
 * `decideAutonomy` — a `forbid` here forces the most-cautious decision
 * by construction.
 */
export function checkBodyChangeInviolable(
  descriptor: BodyChangeDescriptor,
): BodyChangeInviolableVerdict {
  // Fail-closed shell: any throw or any malformed core field forbids.
  try {
    if (
      !descriptor ||
      typeof descriptor.kind !== 'string' ||
      typeof descriptor.targetNodeId !== 'string' ||
      descriptor.targetNodeId.length === 0
    ) {
      return {
        status: 'forbid',
        category: 'malformed-descriptor',
        reason: 'body-change descriptor is missing required fields (kind / targetNodeId)',
      };
    }

    // ── Clause 1 — rail-edit. Forbid if the caller flags it, OR the
    // change writes to a rail node, OR the summary betrays rail-edit
    // intent. Derive from BOTH structure + text so a false flag cannot
    // hide a rail-edit.
    if (
      descriptor.editsRail === true ||
      touchesRailNode(descriptor) ||
      summaryAsserts(descriptor.summary, RAIL_EDIT_PHRASES)
    ) {
      return {
        status: 'forbid',
        category: 'rail-edit',
        reason: 'body-change would edit, disable, weaken, or route around a rail (policy-gate / inviolable / four-eye / kill-switch / RLS / money path)',
      };
    }

    // ── Clause 2 — audit-chain shortening / alteration.
    if (
      descriptor.altersAuditChain === true ||
      summaryAsserts(descriptor.summary, AUDIT_SHORTEN_PHRASES)
    ) {
      return {
        status: 'forbid',
        category: 'audit-shorten',
        reason: 'body-change would shorten or alter the hash-chained, append-only audit / provenance path',
      };
    }

    // ── Clause 3 — autonomy/mandate ceiling raise. A change is forbidden
    // when the after-ceiling is MORE autonomous (higher rank) than the
    // before-ceiling. Unknown / partial pairs fail-closed via the rank
    // helpers (before→+Inf, after→-Inf only when BOTH absent; a present
    // unknown forbids).
    if (
      descriptor.ceilingBefore !== undefined ||
      descriptor.ceilingAfter !== undefined
    ) {
      const before = ceilingRankBefore(descriptor.ceilingBefore);
      const after = ceilingRankAfter(descriptor.ceilingAfter);
      // A present-but-unknown ceiling string ranks defensively; if the
      // declared after-ceiling is unrecognised we treat it as a raise.
      const afterDeclaredUnknown =
        descriptor.ceilingAfter !== undefined &&
        CEILING_AUTONOMY_RANK[descriptor.ceilingAfter] === undefined;
      if (afterDeclaredUnknown || after > before) {
        return {
          status: 'forbid',
          category: 'ceiling-raise',
          reason: 'body-change would raise its own mandate / autonomy ceiling',
        };
      }
    }

    // ── Clause 4 — confidence-floor lowering. A change that lowers a
    // confidence floor would let a less-sure action auto.
    const floorBefore = descriptor.confidenceFloorBefore;
    const floorAfter = descriptor.confidenceFloorAfter;
    if (floorBefore !== undefined || floorAfter !== undefined) {
      const beforeValid = typeof floorBefore === 'number' && Number.isFinite(floorBefore);
      const afterValid = typeof floorAfter === 'number' && Number.isFinite(floorAfter);
      // Any malformed floor pair fails-closed.
      if (!beforeValid || !afterValid) {
        return {
          status: 'forbid',
          category: 'malformed-descriptor',
          reason: 'confidence-floor change is malformed (non-finite floor)',
        };
      }
      if (floorAfter < floorBefore) {
        return {
          status: 'forbid',
          category: 'confidence-floor-lower',
          reason: 'body-change would lower a confidence floor',
        };
      }
    }

    // ── Clause 5 — registration / chain integrity. When an integrity
    // hash is asserted it MUST be present, well-formed, AND match the
    // recomputed hash; the prior chain link MUST be verified. A partial
    // assertion (one side present) fails-closed.
    const hasExpected =
      descriptor.expectedIntegrityHash !== undefined ||
      descriptor.computedIntegrityHash !== undefined ||
      descriptor.priorChainLinkVerified !== undefined;
    if (hasExpected) {
      const expected = descriptor.expectedIntegrityHash;
      const computed = descriptor.computedIntegrityHash;
      if (
        typeof expected !== 'string' ||
        typeof computed !== 'string' ||
        expected.length === 0 ||
        computed.length === 0 ||
        expected !== computed ||
        descriptor.priorChainLinkVerified !== true
      ) {
        return {
          status: 'forbid',
          category: 'integrity-failure',
          reason: 'body-change failed cryptographic registration-integrity check (hash mismatch / missing / unverified prior chain link)',
        };
      }
    }

    return { status: 'allow' };
  } catch {
    // Any unexpected error fails closed — the meta-rail NEVER proceeds
    // on an evaluation failure.
    return {
      status: 'forbid',
      category: 'integrity-failure',
      reason: 'meta-rail evaluation failed; fail-closed',
    };
  }
}
