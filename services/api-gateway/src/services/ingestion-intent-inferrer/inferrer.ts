/**
 * Brilliant intent inferrer — Wave COMPANY-BRAIN (Y-A).
 *
 * Reads an `IngestSnapshot` (post-ingest deterministic state) and asks
 * the LLM ladder: "given this dataset, what tabs / reminders /
 * opportunities / risks make sense for a Tanzanian mining-estate owner?"
 *
 * Returns a structured `IngestIntent` with:
 *   - bilingual narrative (en + sw)
 *   - up to 4 tabs, 3 reminders, 3 opportunities, 3 risks
 *   - every proposal carries ≥1 evidence id and a `reason` string
 *   - confidence score that the owner cockpit uses to dim "low-confidence" rows
 *
 * Failure path: when the LLM is unreachable / rate-limited / returns
 * invalid JSON, we degrade gracefully to the deterministic heuristic in
 * `heuristic.ts` so the cockpit ALWAYS gets a usable IngestIntent.
 *
 * Evidence invariant (hard): the LLM is told "you may ONLY cite chunkIds
 * from the provided list". After parsing, we filter out any evidence id
 * the LLM hallucinated. If a proposal ends up with zero evidence ids we
 * drop the whole proposal — the cockpit must never render an empty
 * evidence chain (CLAUDE.md hard rule).
 */

import type { IngestIntent, IngestSnapshot } from './types.js';
import { generateHeuristicIntent } from './heuristic.js';
import { callBrainOnce } from '../../routes/owner/brain-call.js';

const SYSTEM_PROMPT = `You are Mr. Mwikila, the founder-mode operator of a Tanzanian mining
estate. You just received a NEW document the owner uploaded into the
company brain. Your job is to ANALYZE the post-ingest snapshot and
propose actionable next moves.

Output STRICT JSON only — no markdown fences, no commentary, no prose
outside the JSON object.

The schema you MUST produce:

{
  "narrative_en": "<1-2 sentence English summary the owner will read>",
  "narrative_sw": "<1-2 sentence Swahili summary the owner will read>",
  "confidence":   <0.0-1.0>,
  "proposed_tabs": [
    {
      "tab_type":     "buyers|production|compliance|finance|workforce|chain-of-custody|sites|geology|fleet|marketplace|safety|sales",
      "title_en":     "<short English title, <40 chars>",
      "title_sw":     "<short Swahili title, <40 chars>",
      "reason_en":    "<1 sentence English justification>",
      "reason_sw":    "<1 sentence Swahili justification>",
      "evidence_ids": ["<chunkId or upload id>", ...],
      "confidence":   <0.0-1.0>,
      "config":       {<arbitrary FE-spawn config, JSON object>}
    }
  ],
  "proposed_reminders": [
    {
      "title_en":     "<short English title>",
      "title_sw":     "<short Swahili title>",
      "body_en":      "<1-2 sentence English body>",
      "body_sw":      "<1-2 sentence Swahili body>",
      "trigger_at":   "<ISO-8601 datetime when to fire>",
      "channel":      "email|sms|slack",
      "reason_en":    "<1 sentence why this reminder>",
      "reason_sw":    "<1 sentence kwa nini kumbusho hili>",
      "evidence_ids": ["..."],
      "confidence":   <0.0-1.0>
    }
  ],
  "proposed_opportunities": [
    {
      "kind":               "<short lower-snake kind>",
      "title_en":           "<short English title>",
      "title_sw":           "<short Swahili title>",
      "reason_en":          "<1-2 sentence English justification>",
      "reason_sw":          "<1-2 sentence Swahili justification>",
      "expected_value_tzs": <number|null>,
      "time_window_days":   <integer 1-365>,
      "evidence_ids":       ["..."],
      "confidence":         <0.0-1.0>
    }
  ],
  "proposed_risks": [
    {
      "kind":         "<short lower-snake kind>",
      "title_en":     "<short English title>",
      "title_sw":     "<short Swahili title>",
      "reason_en":    "<1-2 sentence English justification>",
      "reason_sw":    "<1-2 sentence Swahili justification>",
      "severity":     "low|medium|high|critical",
      "evidence_ids": ["..."],
      "confidence":   <0.0-1.0>
    }
  ]
}

HARD RULES (you WILL be rejected if you break these):
1. Every proposal MUST have at least one evidence_id pulled from the
   ALLOWED_EVIDENCE list. NEVER invent a chunk id or filename.
2. Caps: max 4 tabs, max 3 reminders, max 3 opportunities, max 3 risks.
3. Default currency is TZS. Quote the EXACT numbers from the snapshot.
4. Bilingual every label — title_sw and reason_sw must be Swahili, not
   English with a Swahili word sprinkled in.
5. Surface a proposal only when the snapshot really backs it. If the doc
   doesn't justify a reminder, omit the proposal — empty arrays are
   strongly preferred over weak proposals.
6. Be specific. "Review the doc" is NOT a valid reason. Tie every
   proposal to a concrete pattern in the snapshot (entity count, fact,
   keyword, time-span, dominant kind).
7. Look for implicit relationships: late-paying buyers → stricter
   payment terms, repeat buyers that dropped off → re-engage,
   missing chain-of-custody → backfill, expiring permit → renew.
`;

interface ParsedTab {
  tab_type?: string;
  title_en?: string;
  title_sw?: string;
  reason_en?: string;
  reason_sw?: string;
  evidence_ids?: string[];
  confidence?: number;
  config?: Record<string, unknown>;
}
interface ParsedReminder {
  title_en?: string;
  title_sw?: string;
  body_en?: string;
  body_sw?: string;
  trigger_at?: string;
  channel?: string;
  reason_en?: string;
  reason_sw?: string;
  evidence_ids?: string[];
  confidence?: number;
}
interface ParsedOpportunity {
  kind?: string;
  title_en?: string;
  title_sw?: string;
  reason_en?: string;
  reason_sw?: string;
  expected_value_tzs?: number | null;
  time_window_days?: number;
  evidence_ids?: string[];
  confidence?: number;
}
interface ParsedRisk {
  kind?: string;
  title_en?: string;
  title_sw?: string;
  reason_en?: string;
  reason_sw?: string;
  severity?: string;
  evidence_ids?: string[];
  confidence?: number;
}
interface ParsedIntent {
  narrative_en?: string;
  narrative_sw?: string;
  confidence?: number;
  proposed_tabs?: ParsedTab[];
  proposed_reminders?: ParsedReminder[];
  proposed_opportunities?: ParsedOpportunity[];
  proposed_risks?: ParsedRisk[];
}

function safeJson(raw: string): ParsedIntent | null {
  try {
    const fence = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    const body = fence ? fence[1]! : raw.trim();
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as ParsedIntent;
    }
    return null;
  } catch {
    return null;
  }
}

function buildAllowedEvidenceList(snapshot: IngestSnapshot): ReadonlyArray<string> {
  const ids = snapshot.chunkSamples.map((c) => c.chunkId);
  ids.push(`upload:${snapshot.receipt.uploadId}`);
  return Object.freeze(ids);
}

function filterEvidence(
  ids: ReadonlyArray<string> | undefined,
  allowed: ReadonlySet<string>,
): ReadonlyArray<string> {
  if (!ids || !Array.isArray(ids)) return Object.freeze([]);
  const out = ids.filter((id) => typeof id === 'string' && allowed.has(id));
  return Object.freeze(out.slice(0, 5));
}

const SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const CHANNELS = new Set(['email', 'sms', 'slack']);
const TAB_TYPES = new Set([
  'buyers',
  'production',
  'compliance',
  'finance',
  'workforce',
  'chain-of-custody',
  'sites',
  'geology',
  'fleet',
  'marketplace',
  'safety',
  'sales',
]);

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function buildSnapshotPrompt(snapshot: IngestSnapshot): string {
  const entityCounts = new Map<string, number>();
  for (const e of snapshot.availableEntities) {
    entityCounts.set(e.kind, (entityCounts.get(e.kind) ?? 0) + 1);
  }
  const counts = [...entityCounts.entries()]
    .map(([kind, count]) => `${kind}: ${count}`)
    .join(', ');
  const allowedEvidence = buildAllowedEvidenceList(snapshot);
  const keyFactBullets = snapshot.keyFacts
    .slice(0, 6)
    .map((f) => `- ${f.kind}: ${f.value} (conf ${f.confidence.toFixed(2)})`)
    .join('\n');
  const entityBullets = snapshot.availableEntities
    .slice(0, 20)
    .map((e) => `- ${e.kind} :: ${e.displayName}`)
    .join('\n');
  const chunkBullets = snapshot.chunkSamples
    .slice(0, 4)
    .map((c) => `[${c.chunkId}] ${c.excerpt.slice(0, 280)}`)
    .join('\n\n');

  return [
    `INGEST_SUMMARY`,
    `filename: ${snapshot.filename}`,
    `source_kind: ${snapshot.sourceKind}`,
    `detected_language: ${snapshot.detectedLanguage}`,
    `entity_counts: ${counts}`,
    `chunks_count: ${snapshot.receipt.chunksCount}`,
    `entities_extracted: ${snapshot.receipt.entitiesExtracted}`,
    '',
    'EN_SUMMARY',
    snapshot.summaryEn ?? '(none)',
    '',
    'SW_SUMMARY',
    snapshot.summarySw ?? '(none)',
    '',
    'KEY_FACTS',
    keyFactBullets || '(none)',
    '',
    'ENTITIES (first 20)',
    entityBullets || '(none)',
    '',
    'CHUNK_SAMPLES (use ONLY these chunk ids for evidence)',
    chunkBullets || '(none)',
    '',
    'ALLOWED_EVIDENCE',
    JSON.stringify(allowedEvidence),
  ].join('\n');
}

function normalise(
  parsed: ParsedIntent,
  snapshot: IngestSnapshot,
  provider: string,
  generatedAtIso: string,
): IngestIntent {
  const allowed = new Set(buildAllowedEvidenceList(snapshot));

  const tabs = (parsed.proposed_tabs ?? [])
    .slice(0, 4)
    .map((t) => {
      const evidenceIds = filterEvidence(t.evidence_ids, allowed);
      if (evidenceIds.length === 0) return null;
      const tabType = typeof t.tab_type === 'string' && TAB_TYPES.has(t.tab_type)
        ? t.tab_type
        : 'sales';
      return {
        tabType,
        titleEn: (t.title_en ?? 'Untitled tab').slice(0, 60),
        titleSw: (t.title_sw ?? 'Kichupo').slice(0, 60),
        reasonEn: (t.reason_en ?? '').slice(0, 400),
        reasonSw: (t.reason_sw ?? '').slice(0, 400),
        evidenceIds,
        confidence: clampConfidence(t.confidence),
        config:
          t.config && typeof t.config === 'object'
            ? Object.freeze({ ...t.config, sourceUpload: snapshot.receipt.uploadId })
            : Object.freeze({ sourceUpload: snapshot.receipt.uploadId }),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const reminders = (parsed.proposed_reminders ?? [])
    .slice(0, 3)
    .map((r) => {
      const evidenceIds = filterEvidence(r.evidence_ids, allowed);
      if (evidenceIds.length === 0) return null;
      const triggerAt =
        typeof r.trigger_at === 'string' && Number.isFinite(Date.parse(r.trigger_at))
          ? r.trigger_at
          : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const channel = typeof r.channel === 'string' && CHANNELS.has(r.channel)
        ? (r.channel as 'email' | 'sms' | 'slack')
        : 'email';
      return {
        titleEn: (r.title_en ?? 'Reminder').slice(0, 200),
        titleSw: (r.title_sw ?? 'Kumbusho').slice(0, 200),
        bodyEn: (r.body_en ?? '').slice(0, 2000),
        bodySw: (r.body_sw ?? '').slice(0, 2000),
        triggerAtIso: triggerAt,
        channel,
        reasonEn: (r.reason_en ?? '').slice(0, 400),
        reasonSw: (r.reason_sw ?? '').slice(0, 400),
        evidenceIds,
        confidence: clampConfidence(r.confidence),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const opportunities = (parsed.proposed_opportunities ?? [])
    .slice(0, 3)
    .map((o) => {
      const evidenceIds = filterEvidence(o.evidence_ids, allowed);
      if (evidenceIds.length === 0) return null;
      const timeWindowDays =
        typeof o.time_window_days === 'number' && o.time_window_days > 0
          ? Math.min(365, Math.round(o.time_window_days))
          : 30;
      const expected =
        typeof o.expected_value_tzs === 'number' && Number.isFinite(o.expected_value_tzs)
          ? Math.max(0, Math.round(o.expected_value_tzs))
          : null;
      return {
        kind: (typeof o.kind === 'string' ? o.kind : 'opportunity').slice(0, 64),
        titleEn: (o.title_en ?? '').slice(0, 200),
        titleSw: (o.title_sw ?? '').slice(0, 200),
        reasonEn: (o.reason_en ?? '').slice(0, 400),
        reasonSw: (o.reason_sw ?? '').slice(0, 400),
        expectedValueTzs: expected,
        timeWindowDays,
        evidenceIds,
        confidence: clampConfidence(o.confidence),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const risks = (parsed.proposed_risks ?? [])
    .slice(0, 3)
    .map((r) => {
      const evidenceIds = filterEvidence(r.evidence_ids, allowed);
      if (evidenceIds.length === 0) return null;
      const severity =
        typeof r.severity === 'string' && SEVERITIES.has(r.severity)
          ? (r.severity as 'low' | 'medium' | 'high' | 'critical')
          : 'medium';
      return {
        kind: (typeof r.kind === 'string' ? r.kind : 'risk').slice(0, 64),
        titleEn: (r.title_en ?? '').slice(0, 200),
        titleSw: (r.title_sw ?? '').slice(0, 200),
        reasonEn: (r.reason_en ?? '').slice(0, 400),
        reasonSw: (r.reason_sw ?? '').slice(0, 400),
        severity,
        evidenceIds,
        confidence: clampConfidence(r.confidence),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const narrativeEn = (parsed.narrative_en ?? '').slice(0, 400);
  const narrativeSw = (parsed.narrative_sw ?? '').slice(0, 400);
  const totalProposals =
    tabs.length + reminders.length + opportunities.length + risks.length;

  return Object.freeze({
    proposedTabs: Object.freeze(tabs),
    proposedReminders: Object.freeze(reminders),
    proposedOpportunities: Object.freeze(opportunities),
    proposedRisks: Object.freeze(risks),
    confidence: clampConfidence(parsed.confidence ?? (totalProposals === 0 ? 0.2 : 0.6)),
    narrativeEn:
      narrativeEn ||
      `Borjie analysed ${snapshot.filename} and surfaced ${totalProposals} proposal(s).`,
    narrativeSw:
      narrativeSw ||
      `Borjie imechanganua ${snapshot.filename} na imependekeza mambo ${totalProposals}.`,
    reasonTag: `${provider}-v1`,
    provider,
    generatedAtIso,
  });
}

export interface InferIntentOptions {
  readonly now?: () => Date;
  /** Hard override: skip the LLM and use the heuristic. Used by tests. */
  readonly forceHeuristic?: boolean;
  readonly logger?:
    | {
        info(obj: Record<string, unknown>, msg?: string): void;
        warn(obj: Record<string, unknown>, msg?: string): void;
      }
    | undefined;
}

export async function inferIngestIntent(
  snapshot: IngestSnapshot,
  options?: InferIntentOptions,
): Promise<IngestIntent> {
  const now = options?.now?.() ?? new Date();
  const log = options?.logger;

  if (options?.forceHeuristic) {
    return generateHeuristicIntent(snapshot, { now: () => now });
  }

  try {
    const reply = await callBrainOnce({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildSnapshotPrompt(snapshot),
      maxTokens: 1400,
    });
    const parsed = safeJson(reply.text);
    if (!parsed) {
      log?.warn(
        { uploadId: snapshot.receipt.uploadId, provider: reply.provider },
        'intent-inferrer: LLM returned non-JSON — falling back to heuristic',
      );
      return generateHeuristicIntent(snapshot, { now: () => now });
    }
    const intent = normalise(parsed, snapshot, reply.provider, now.toISOString());
    const totalProposals =
      intent.proposedTabs.length +
      intent.proposedReminders.length +
      intent.proposedOpportunities.length +
      intent.proposedRisks.length;
    if (totalProposals === 0) {
      // The LLM may have dropped every proposal during the evidence
      // filter. Fall back to the heuristic so the cockpit still has
      // something to render.
      log?.info(
        { uploadId: snapshot.receipt.uploadId },
        'intent-inferrer: LLM zero proposals after evidence filter — heuristic backfill',
      );
      return generateHeuristicIntent(snapshot, { now: () => now });
    }
    return intent;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log?.warn(
      { uploadId: snapshot.receipt.uploadId, error: message.slice(0, 240) },
      'intent-inferrer: LLM failed — heuristic fallback',
    );
    return generateHeuristicIntent(snapshot, { now: () => now });
  }
}
