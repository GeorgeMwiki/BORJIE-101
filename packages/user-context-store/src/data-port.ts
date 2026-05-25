/**
 * `createUserContextDataPort` — the headline factory.
 *
 * Wires profile + signals + triggers + scoped semantic search into a
 * single {@link DataPort} satisfying P7's contract. P7 calls
 * `fetchSnippets({ role, tenantId, userId, intent, question })`; this
 * implementation runs:
 *
 *   1. Build the role-aware profile dossier
 *   2. Gather behavioral signals (recent activity, open items,
 *      lifecycle stage, intent signals)
 *   3. Compute proactive triggers; promote high-urgency triggers into
 *      first-class snippets so the LLM can volunteer context the user
 *      didn't explicitly ask about
 *   4. Run scoped semantic search against the corpus index using the
 *      question text
 *   5. Synthesize a unified Snippet[] ranked by relevance to (intent,
 *      question)
 *   6. Record the fetch in the audit sink
 *   7. Return the snippets
 *
 * Consent: revoked → empty snippets, still audits.
 */
import type {
  AnyProfile,
  Citation,
  ConsentDecision,
  ContextAuditPort,
  DataPort,
  Embedder,
  IntentSignal,
  OwnerProfile,
  PMProfile,
  Role,
  Snippet,
  TenantProfile,
  Trigger,
} from './types.js';
import { buildProfile } from './profile/index.js';
import { gatherSignals } from './signals/index.js';
import { computeTriggers } from './triggers/index.js';
import { InMemoryCorpusIndex } from './search/in-memory-index.js';
import { consentCheck } from './privacy/consent.js';
import { minimizePII } from './privacy/pii-minimizer.js';

export interface CreateUserContextDataPortArgs {
  readonly db: unknown;
  readonly embedder: Embedder;
  readonly audit: ContextAuditPort;
  readonly index: InMemoryCorpusIndex;
  /** Default k for semantic search. */
  readonly searchK?: number;
  /** Cap on total snippets returned. */
  readonly snippetCap?: number;
}

function audienceFor(role: Role): import('./types.js').Audience {
  switch (role) {
    case 'tenant':
    case 'prospect':
      return 'data_subject';
    case 'owner':
      return 'owner';
    case 'pm':
      return 'pm';
    case 'estate_mgr':
      return 'estate_mgr';
    case 'admin':
      return 'admin';
    default:
      return 'data_subject';
  }
}

function isOwner(p: AnyProfile): p is OwnerProfile {
  return Array.isArray((p as Partial<OwnerProfile>).properties);
}
function isPM(p: AnyProfile): p is PMProfile {
  return Array.isArray((p as Partial<PMProfile>).managedProperties);
}
function isTenant(p: AnyProfile): p is TenantProfile {
  if (isOwner(p) || isPM(p)) return false;
  return true;
}

function profileSnippets(profile: AnyProfile, role: Role): Snippet[] {
  const out: Snippet[] = [];
  if (role === 'tenant' && isTenant(profile)) {
    const lease = profile.currentLease;
    if (lease) {
      out.push({
        source: `lease ${lease.leaseNumber}`,
        content: `Active lease ${lease.leaseNumber}; status ${lease.status}; rent ${lease.rentAmount ?? '?'} ${lease.rentCurrency ?? ''}; ends ${lease.endDate ?? 'unknown'}.`,
        citation: { kind: 'lease', id: lease.leaseId },
        confidence: 0.9,
      });
    }
    const unit = profile.unit;
    if (unit) {
      out.push({
        source: `unit ${unit.unitNumber}`,
        content: `Unit ${unit.unitNumber}, floor ${unit.floor ?? '?'}, ${unit.bedrooms ?? '?'} bed / ${unit.bathrooms ?? '?'} bath, ${unit.sizeSqm ?? '?'} sqm.`,
        citation: { kind: 'unit', id: unit.unitId },
        confidence: 0.85,
      });
    }
    const property = profile.property;
    if (property) {
      out.push({
        source: `property ${property.propertyCode}`,
        content: `${property.name} (${property.propertyCode}) in ${property.city ?? '?'}, ${property.country ?? '?'}; ${property.totalUnits ?? '?'} units.`,
        citation: { kind: 'property', id: property.propertyId },
        confidence: 0.8,
      });
    }
  }
  if (role === 'owner' && isOwner(profile)) {
    for (const p of profile.properties.slice(0, 5)) {
      out.push({
        source: `portfolio property ${p.propertyName}`,
        content: `${p.propertyName}: occupancy ${p.occupancyPct?.toFixed(1) ?? '?'}%, NOI 12m ${p.noiAnnualized ?? '?'} ${p.currency}.`,
        citation: { kind: 'property', id: p.propertyId },
        confidence: 0.85,
      });
    }
  }
  if (role === 'pm' && isPM(profile)) {
    for (const mp of profile.managedProperties.slice(0, 5)) {
      out.push({
        source: `managed property ${mp.name}`,
        content: `Managing property ${mp.name}.`,
        citation: { kind: 'property', id: mp.propertyId },
        confidence: 0.75,
      });
    }
  }
  return out;
}

function intentSignalSnippets(intents: ReadonlyArray<IntentSignal>): Snippet[] {
  return intents.slice(0, 5).map((i, idx) => ({
    source: `intent signal #${idx + 1}`,
    content: `${i.kind}: ${i.evidence}`,
    citation: { kind: 'signal', id: `${i.kind}:${idx}` },
    confidence: Math.min(0.95, 0.5 + i.confidence * 0.4),
  }));
}

function triggerToSnippet(trigger: Trigger): Snippet {
  return {
    source: `trigger ${trigger.kind}`,
    content: `${trigger.summary} — suggested: ${trigger.suggestedAction}`,
    citation: { kind: 'trigger', id: trigger.id },
    confidence: 0.6 + trigger.urgency * 0.07,
  };
}

function intentBias(snippet: Snippet, intent: string): number {
  if (!intent) return 0;
  const lower = snippet.content.toLowerCase();
  const tokens = intent.toLowerCase().split(/\W+/).filter((t) => t.length >= 4);
  let hits = 0;
  for (const t of tokens) if (lower.includes(t)) hits += 1;
  return hits === 0 ? 0 : Math.min(0.2, hits * 0.05);
}

/**
 * Build a {@link DataPort} that the role-aware advisor (P7) can consume.
 */
export function createUserContextDataPort(
  args: CreateUserContextDataPortArgs,
): DataPort {
  const searchK = args.searchK ?? 5;
  const cap = args.snippetCap ?? 12;

  return {
    async fetchSnippets({ role, tenantId, userId, intent, question }) {
      // 1. Profile + signals first — cheap, deterministic.
      const profile = await buildProfile({ role, userId, tenantId, db: args.db });
      const signals = await gatherSignals({
        role,
        userId,
        tenantId,
        db: args.db,
        profile,
      });

      // 2. Triggers — promote high-urgency ones into snippet form.
      const triggers = computeTriggers({
        profile,
        signals,
        role,
        userId,
        tenantId,
      });
      const triggerSnippets = triggers
        .filter((t) => t.urgency >= 4)
        .slice(0, 3)
        .map(triggerToSnippet);

      // 3. Profile-grounded snippets.
      const dossier = profileSnippets(profile, role);

      // 4. Intent-signal snippets.
      const intentSnips = intentSignalSnippets(signals.intentSignals);

      // 5. Consent.
      const consent: ConsentDecision = await consentCheck({
        userId,
        tenantId,
        purpose: 'advisor',
        db: args.db,
      });

      // 6. Scoped semantic search (skip when revoked).
      let searchSnippets: Snippet[] = [];
      if (consent !== 'revoked') {
        try {
          const hits = await args.index.searchScoped({
            tenantId,
            userId,
            role,
            query: question,
            k: searchK,
          });
          searchSnippets = hits.map((h) => ({
            source: h.item.source,
            content: h.item.content,
            citation: h.item.citation,
            confidence: Math.max(0, Math.min(1, h.similarity)),
            ...(h.item.timestamp ? { timestamp: h.item.timestamp } : {}),
          }));
        } catch {
          // Search failure shouldn't black-hole the advisor — degrade
          // to profile + signals only.
          searchSnippets = [];
        }
      }

      // 7. Merge + rank + minimize PII + cap.
      const combined =
        consent === 'revoked'
          ? []
          : [...triggerSnippets, ...dossier, ...intentSnips, ...searchSnippets];

      const audience = audienceFor(role);
      const ranked = combined
        .map((s) => ({ s, score: s.confidence + intentBias(s, intent) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, cap)
        .map(({ s }) => minimizePII(s, audience));

      // 8. Audit (always — even when consent revoked, so we can prove
      //    we honoured the opt-out).
      const citations: ReadonlyArray<Citation> = ranked.map((s) => s.citation);
      await Promise.resolve(
        args.audit.recordFetch({
          tenantId,
          userId,
          role,
          intent,
          question,
          snippetCount: ranked.length,
          citations,
          consent,
          timestamp: new Date().toISOString(),
        }),
      );

      return ranked;
    },
  };
}
