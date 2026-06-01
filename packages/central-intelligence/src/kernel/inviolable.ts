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
