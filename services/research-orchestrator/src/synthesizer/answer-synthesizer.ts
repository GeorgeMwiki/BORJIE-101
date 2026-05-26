/**
 * Answer synthesizer — composes scored artifacts into a citation-anchored
 * markdown answer (DEEP_RESEARCH_SPEC §4.4).
 *
 * Two paths:
 *
 *   1. LLM path (preferred for Reactive Query, Deep Dive). Calls the
 *      injected `synthesize` function — wired by the composition root
 *      to `@borjie/brain-llm-router`'s `brainCall({ task: 'plan' })`
 *      style invocation. The LLM produces the summary; this module
 *      stamps the citation chips in via the SpanCitation contract.
 *
 *   2. Rule-based path (Daily Briefing, Continuous Watch). The
 *      template-fixed modes don't need an LLM — they format the
 *      artifacts directly into a structured markdown report. Cheaper,
 *      faster, fully deterministic.
 *
 * Spec anti-pattern §12.5: "MUST NOT return a result without an audit
 * hash." This module returns a ResearchResult with `audit_hash` set —
 * the audit-emitter wraps it in the actual chain row.
 *
 * @module research-orchestrator/synthesizer/answer-synthesizer
 */

import { randomUUID, createHash } from 'node:crypto';
import type {
  ResearchArtifact,
  ResearchPlan,
  ResearchResult,
  SpanCitation,
} from '../types.js';
import { rescoreArtifacts } from '../scorer/artifact-scorer.js';
import { calibrateConfidence } from './confidence-calibrator.js';
import { detectDisagreements } from './disagreement-detector.js';

export interface SynthesizeInput {
  readonly plan: ResearchPlan;
  readonly artifacts: ReadonlyArray<ResearchArtifact>;
  readonly total_cost_usd_cents: number;
  readonly total_duration_ms: number;
  /** Optional LLM call to render the markdown body. */
  readonly llmSynthesize?: (req: LlmSynthesizeRequest) => Promise<string>;
  /** Optional ISO override (tests). */
  readonly nowIso?: string;
  /** Whether the topic is fast-moving (drives the 90-day recency decay). */
  readonly fast_moving_topic?: boolean;
}

export interface LlmSynthesizeRequest {
  readonly query: string;
  readonly mode: ResearchPlan['mode'];
  readonly artifacts: ReadonlyArray<ResearchArtifact>;
  readonly tenantId: string;
}

/**
 * Produce a ResearchResult. Always returns — even when artifacts is
 * empty, the result is a valid "no findings" with confidence='low'.
 */
export async function synthesizeAnswer(
  input: SynthesizeInput,
): Promise<ResearchResult> {
  // Re-score with cross-referencing applied.
  const rescore = rescoreArtifacts({
    artifacts: input.artifacts,
    ...(input.fast_moving_topic !== undefined
      ? { fast_moving_topic: input.fast_moving_topic }
      : {}),
  });
  const scored = rescore.artifacts;

  // Calibrate confidence.
  const conf = calibrateConfidence({ artifacts: scored });

  // Build the markdown body.
  const summaryMd = input.llmSynthesize
    ? await safeLlmRender(input.llmSynthesize, {
        query: input.plan.query,
        mode: input.plan.mode,
        artifacts: scored,
        tenantId: input.plan.tenant_id,
      })
    : renderRuleBased(input.plan, scored, conf.confidence);

  // Build span citations from each artifact.
  const spanCitations = buildSpanCitations(scored);

  // Detect disagreements.
  const disagreements = detectDisagreements(scored);

  // Compute the audit hash (sha256 of canonical-JSON of the result body).
  const resultId = randomUUID();
  const generatedAt = input.nowIso ?? new Date().toISOString();
  const auditHash = computeAuditHash({
    result_id: resultId,
    plan_id: input.plan.id,
    summary_md: summaryMd,
    citation_ids: scored.map((a) => a.citation_id),
    cost_usd_cents: input.total_cost_usd_cents,
    elapsed_ms: input.total_duration_ms,
  });

  return {
    id: resultId,
    plan_id: input.plan.id,
    summary_md: summaryMd,
    span_citations: spanCitations,
    confidence: conf.confidence,
    disagreements,
    audit_hash: auditHash,
    generated_at: generatedAt,
    total_cost_usd_cents: input.total_cost_usd_cents,
    total_duration_ms: input.total_duration_ms,
  };
}

async function safeLlmRender(
  llm: (req: LlmSynthesizeRequest) => Promise<string>,
  req: LlmSynthesizeRequest,
): Promise<string> {
  try {
    const md = await llm(req);
    if (typeof md === 'string' && md.trim().length > 0) return md;
  } catch {
    // Fall through to rule-based.
  }
  return renderRuleBased({ ...req, id: '', created_at: '', steps: [], status: 'complete', result_id: null, budget_ms: 0, budget_usd_cents: 0, query: req.query, mode: req.mode, tenant_id: req.tenantId, created_by: 'mr_mwikila' } as unknown as ResearchPlan, req.artifacts, 'low');
}

function renderRuleBased(
  plan: ResearchPlan,
  artifacts: ReadonlyArray<ResearchArtifact>,
  confidence: 'high' | 'medium' | 'low',
): string {
  if (artifacts.length === 0) {
    return [
      `# ${plan.query || 'Research result'}`,
      ``,
      `**No artifacts retrieved.**`,
      ``,
      `_Confidence: low — corpus + web returned no usable sources._`,
    ].join('\n');
  }

  const lines: Array<string> = [];
  lines.push(`# ${plan.query || 'Research summary'}`);
  lines.push('');
  lines.push(`_Mode: ${plan.mode} · Confidence: ${confidence}_`);
  lines.push('');

  // Group by source_kind so the briefing reads naturally.
  const byKind = new Map<string, Array<ResearchArtifact>>();
  for (const a of artifacts) {
    const arr = byKind.get(a.source_kind);
    if (arr) {
      arr.push(a);
    } else {
      byKind.set(a.source_kind, [a]);
    }
  }

  for (const [kind, kindArtifacts] of byKind.entries()) {
    lines.push(`## ${humanKind(kind)}`);
    for (const a of kindArtifacts) {
      const cite = `[${a.citation_id}]`;
      const flag = a.bias_flags.length > 0 ? ` _(flags: ${a.bias_flags.join(', ')})_` : '';
      lines.push(`- **${a.title}** ${cite}${flag}`);
      if (a.excerpt) lines.push(`  ${a.excerpt}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function humanKind(kind: string): string {
  switch (kind) {
    case 'web':
      return 'Web sources';
    case 'corpus':
      return 'Internal corpus';
    case 'feed':
      return 'Live feeds';
    case 'pdf':
      return 'PDF documents';
    case 'image':
      return 'Images';
    case 'table':
      return 'Tables';
    default:
      return kind;
  }
}

function buildSpanCitations(
  artifacts: ReadonlyArray<ResearchArtifact>,
): ReadonlyArray<SpanCitation> {
  return Object.freeze(
    artifacts.map((a) => ({
      citation_id: a.citation_id,
      source_uri: a.source_uri,
      kind: spanKind(a.source_kind),
      quoted_span: a.excerpt || a.content.slice(0, 200),
      start_offset: 0,
      end_offset: Math.min(a.content.length, a.excerpt?.length ?? 200),
      overlap: 1,
    })),
  );
}

function spanKind(kind: ResearchArtifact['source_kind']): SpanCitation['kind'] {
  switch (kind) {
    case 'web':
    case 'feed':
      return 'web';
    case 'corpus':
      return 'corpus';
    case 'pdf':
      return 'pdf';
    case 'image':
    case 'table':
      return 'web';
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

function computeAuditHash(args: {
  readonly result_id: string;
  readonly plan_id: string;
  readonly summary_md: string;
  readonly citation_ids: ReadonlyArray<string>;
  readonly cost_usd_cents: number;
  readonly elapsed_ms: number;
}): string {
  // Deterministic canonical-JSON-style hash; the audit-emitter passes
  // a full ChainEntry through `@borjie/audit-hash-chain` for the
  // tenant-scoped chain row.
  const payload = JSON.stringify({
    result_id: args.result_id,
    plan_id: args.plan_id,
    summary_md_sha: createHash('sha256').update(args.summary_md).digest('hex'),
    citation_ids: [...args.citation_ids].sort(),
    cost_usd_cents: args.cost_usd_cents,
    elapsed_ms: args.elapsed_ms,
  });
  return createHash('sha256').update(payload).digest('hex');
}
