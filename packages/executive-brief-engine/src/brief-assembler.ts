/**
 * @borjie/executive-brief-engine — brief-assembler.
 *
 * The final step: take debated hypotheses + recommended actions, fold
 * them into a single ExecutiveBrief that:
 *
 *   - Builds a unified `citations[]` array (deduplicated by entity_id /
 *     audit_event_id / document_id) with claimIndex back-pointers.
 *   - Resolves every Finding's `citationIndices` against that array.
 *   - Resolves every RecommendedAction's `citationIndices` from its
 *     source hypothesis.
 *   - Computes the sha256 hash chaining to the prior brief's hash.
 *   - Zod-validates the result; throws on any uncited claim.
 *
 * This is the gate before persistence — if the schema rejects, we
 * surface the validation errors so the orchestrator can degrade.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  ExecutiveBriefSchema,
  type Citation,
  type ExecutiveBrief,
  type Finding,
  type Gap,
  type Opportunity,
  type RecommendedAction,
  type Risk,
} from './types.js';
import type { DebatedHypothesis } from './debate.js';
import type { VerifiedHypothesis } from './hypothesis-verifier.js';
import type { RetrievalHit } from './retrieval.js';

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

export interface AssembleArgs {
  readonly tenantId: string;
  readonly personaId: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly scope: ExecutiveBrief['scope'];
  readonly hypotheses: ReadonlyArray<DebatedHypothesis | VerifiedHypothesis>;
  readonly recommendedActions: ReadonlyArray<RecommendedAction>;
  readonly actionSourceMap: ReadonlyArray<{ readonly hypothesisIndex: number }>;
  readonly approvalPackets?: ReadonlyArray<ExecutiveBrief['approvalPackets'][number]>;
  readonly locale: string;
  readonly generatorVersion: string;
  readonly costMicros?: number;
  readonly prevHash: string | null;
  readonly auditChainLink?: string | null;
  readonly degraded?: boolean;
  readonly generatedAt?: Date;
  readonly briefId?: string;
}

/**
 * Build the structured ExecutiveBrief. Throws an Error if the Zod
 * schema rejects (uncited claim, malformed citations, etc.) — callers
 * should catch + degrade.
 */
export function assembleBrief(args: AssembleArgs): ExecutiveBrief {
  // ── Step 1: build deduplicated citations array. ───────────────────
  const citationKey = (ref: {
    entityId?: string;
    auditEventId?: string;
    documentId?: string;
  }): string =>
    `${ref.entityId ?? ''}|${ref.auditEventId ?? ''}|${ref.documentId ?? ''}`;

  const citationByKey = new Map<string, number>();
  const citations: Citation[] = [];

  function ensureCitation(args: {
    claimKind: Citation['claimKind'];
    claimIndex: number;
    hit?: RetrievalHit;
    rawRef?: { entityId?: string; auditEventId?: string; documentId?: string; page?: number; note?: string };
  }): number {
    const ref =
      args.rawRef ?? {
        ...(args.hit?.kind === 'entity' ? { entityId: args.hit.id } : {}),
        ...(args.hit?.kind === 'audit_event' ? { auditEventId: args.hit.id } : {}),
        ...(args.hit?.kind === 'document' ? { documentId: args.hit.id } : {}),
        ...(args.hit?.snippet ? { note: args.hit.snippet.slice(0, 500) } : {}),
      };

    if (!ref.entityId && !ref.auditEventId && !ref.documentId) {
      throw new Error('ensureCitation called with no concrete evidence');
    }

    const key = citationKey(ref);
    const existing = citationByKey.get(key);
    if (existing !== undefined) return existing;
    const newCitation = {
      claimKind: args.claimKind,
      claimIndex: args.claimIndex,
      ...(ref.entityId ? { entityId: ref.entityId } : {}),
      ...(ref.auditEventId ? { auditEventId: ref.auditEventId } : {}),
      ...(ref.documentId ? { documentId: ref.documentId } : {}),
      ...(ref.page !== undefined ? { page: ref.page } : {}),
      ...(ref.note ? { note: ref.note } : {}),
    } as Citation;
    citations.push(newCitation);
    const idx = citations.length - 1;
    citationByKey.set(key, idx);
    return idx;
  }

  // ── Step 2: bucket hypotheses by kind and build Findings. ─────────
  const gaps: Gap[] = [];
  const opportunities: Opportunity[] = [];
  const risks: Risk[] = [];

  // We need stable indices per kind for the Citation's claimIndex.
  const hypothesisFindingIndex: Array<{ kind: 'gap' | 'opportunity' | 'risk'; finding: Finding }> = [];

  for (let i = 0; i < args.hypotheses.length; i += 1) {
    const verified = args.hypotheses[i]!;
    const evidence = verified.evidence;
    // We don't have global citation indices yet — we collect refs first
    // and resolve indices in a second pass after we know each finding's
    // claimIndex.
    const kind = verified.hypothesis.kind;
    const placeholderFinding: Finding = {
      title: verified.hypothesis.title,
      description: appendDebateNote(verified),
      severity: verified.hypothesis.severity,
      citationIndices: [],
      confidence: clamp01(verified.judgeScore),
    };
    hypothesisFindingIndex.push({ kind, finding: placeholderFinding });

    let claimIndex: number;
    switch (kind) {
      case 'gap':
        gaps.push(placeholderFinding);
        claimIndex = gaps.length - 1;
        break;
      case 'opportunity':
        opportunities.push(placeholderFinding);
        claimIndex = opportunities.length - 1;
        break;
      case 'risk':
      default:
        risks.push(placeholderFinding);
        claimIndex = risks.length - 1;
        break;
    }

    // Resolve citation indices for THIS finding.
    const ciList: number[] = [];
    for (const hit of evidence) {
      try {
        const idx = ensureCitation({
          claimKind: kind,
          claimIndex,
          hit,
        });
        ciList.push(idx);
      } catch {
        // Skip evidence without a concrete id.
      }
    }
    // Also include the hypothesis's original evidenceRefs.
    for (const raw of verified.hypothesis.evidenceRefs) {
      // Skip refs missing required fields (Zod schema makes both optional
      // under exactOptionalPropertyTypes; mapRawRef requires them).
      if (!raw.kind || !raw.id) continue;
      const rawRef = mapRawRef({
        kind: raw.kind,
        id: raw.id,
        ...(raw.page !== undefined ? { page: raw.page } : {}),
      });
      if (!rawRef) continue;
      const idx = ensureCitation({
        claimKind: kind,
        claimIndex,
        rawRef,
      });
      ciList.push(idx);
    }
    // Dedup citation indices.
    placeholderFinding.citationIndices = Array.from(new Set(ciList));

    // Refuse uncited findings. Surface the error so the caller can degrade.
    if (placeholderFinding.citationIndices.length === 0) {
      throw new Error(
        `assembleBrief: finding "${verified.hypothesis.title}" has no citations after assembly`,
      );
    }
  }

  // ── Step 3: resolve RecommendedAction citationIndices via source map. ─
  const actions: RecommendedAction[] = [];
  for (let i = 0; i < args.recommendedActions.length; i += 1) {
    const action = args.recommendedActions[i]!;
    const src = args.actionSourceMap[i];
    let ci: number[] = [];
    if (src && src.hypothesisIndex < args.hypotheses.length) {
      const verified = args.hypotheses[src.hypothesisIndex]!;
      const claimIndexPair = hypothesisFindingIndex[src.hypothesisIndex]!;
      let actionClaimIndex = 0;
      switch (claimIndexPair.kind) {
        case 'gap':
          actionClaimIndex = gaps.indexOf(claimIndexPair.finding);
          break;
        case 'opportunity':
          actionClaimIndex = opportunities.indexOf(claimIndexPair.finding);
          break;
        case 'risk':
          actionClaimIndex = risks.indexOf(claimIndexPair.finding);
          break;
      }
      for (const hit of verified.evidence) {
        try {
          const idx = ensureCitation({
            claimKind: 'recommended_action',
            claimIndex: i,
            hit,
          });
          // For action citations we point both ways — into the action
          // index AND log a side citation row keyed to the source finding.
          // The schema only needs at least one entry per claim.
          ci.push(idx);
        } catch {
          // skip
        }
      }
      // Also include the underlying hypothesis evidence refs.
      for (const raw of verified.hypothesis.evidenceRefs) {
        // Skip refs missing required fields (Zod schema makes both optional
        // under exactOptionalPropertyTypes; mapRawRef requires them).
        if (!raw.kind || !raw.id) continue;
        const rawRef = mapRawRef({
          kind: raw.kind,
          id: raw.id,
          ...(raw.page !== undefined ? { page: raw.page } : {}),
        });
        if (!rawRef) continue;
        const idx = ensureCitation({
          claimKind: 'recommended_action',
          claimIndex: i,
          rawRef,
        });
        ci.push(idx);
      }
      ci = Array.from(new Set(ci));
      void actionClaimIndex; // claimIndex is used only for the citation row.
    }
    if (ci.length === 0) {
      // RecommendedAction without citation — drop it rather than fail the brief.
      continue;
    }
    actions.push({
      ...action,
      citationIndices: ci,
    });
  }

  // ── Step 4: serialise + hash. ─────────────────────────────────────
  const generatedAt = args.generatedAt ?? new Date();
  const briefId = args.briefId ?? `ebr_${randomUUID()}`;

  const payloadForHash = {
    tenantId: args.tenantId,
    personaId: args.personaId,
    scope: args.scope,
    gaps,
    opportunities,
    risks,
    recommendedActions: actions,
    approvalPackets: args.approvalPackets ?? [],
    citations,
    locale: args.locale,
    periodStart: args.periodStart.toISOString(),
    periodEnd: args.periodEnd.toISOString(),
    generatorVersion: args.generatorVersion,
    prevHash: args.prevHash,
  };
  const hash = computeHash(args.prevHash, payloadForHash);

  // ── Step 5: zod-validate. ─────────────────────────────────────────
  const candidate = {
    id: briefId,
    tenantId: args.tenantId,
    personaId: args.personaId,
    scope: args.scope,
    gaps,
    opportunities,
    risks,
    recommendedActions: actions,
    approvalPackets: args.approvalPackets ?? [],
    citations,
    locale: args.locale,
    generatedAt,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    generatorVersion: args.generatorVersion,
    ...(args.costMicros !== undefined ? { costMicros: args.costMicros } : {}),
    hash,
    prevHash: args.prevHash,
    auditChainLink: args.auditChainLink ?? null,
    status: 'GENERATED' as const,
    degraded: args.degraded ?? false,
  };

  const parsed = ExecutiveBriefSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(
      `assembleBrief: schema validation failed — ${parsed.error.issues
        .map((iss) => `${iss.path.join('.')}: ${iss.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function appendDebateNote(verified: DebatedHypothesis | VerifiedHypothesis): string {
  const base = verified.hypothesis.description;
  if ('debateNote' in verified && verified.debateNote) {
    return `${base}\n\n[Debate]: ${verified.debateNote}`;
  }
  return base;
}

function mapRawRef(
  raw: {
    kind: 'entity' | 'audit_event' | 'document';
    id: string;
    page?: number | undefined;
  },
): { entityId?: string; auditEventId?: string; documentId?: string; page?: number } | null {
  switch (raw.kind) {
    case 'entity':
      return { entityId: raw.id };
    case 'audit_event':
      return { auditEventId: raw.id };
    case 'document':
      return {
        documentId: raw.id,
        ...(raw.page !== undefined ? { page: raw.page } : {}),
      };
    default:
      return null;
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Canonical JSON serialise with sorted keys — guarantees the same
 * payload always produces the same hash regardless of key insertion
 * order.
 */
export function canonicalJson(input: unknown): string {
  if (input === null || typeof input !== 'object') return JSON.stringify(input);
  if (Array.isArray(input)) {
    return `[${input.map(canonicalJson).join(',')}]`;
  }
  const obj = input as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
  return `{${parts.join(',')}}`;
}

export function computeHash(prevHash: string | null, payload: unknown): string {
  const hasher = createHash('sha256');
  if (prevHash) hasher.update(prevHash);
  hasher.update(canonicalJson(payload));
  return hasher.digest('hex');
}

/**
 * Tamper detection — recompute the hash from the brief's stored fields
 * and compare. Returns true when the chain link is intact.
 */
export function verifyBriefHash(brief: ExecutiveBrief): boolean {
  const recomputed = computeHash(brief.prevHash, {
    tenantId: brief.tenantId,
    personaId: brief.personaId,
    scope: brief.scope,
    gaps: brief.gaps,
    opportunities: brief.opportunities,
    risks: brief.risks,
    recommendedActions: brief.recommendedActions,
    approvalPackets: brief.approvalPackets,
    citations: brief.citations,
    locale: brief.locale,
    periodStart: brief.periodStart.toISOString(),
    periodEnd: brief.periodEnd.toISOString(),
    generatorVersion: brief.generatorVersion,
    prevHash: brief.prevHash,
  });
  return recomputed === brief.hash;
}
