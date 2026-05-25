/**
 * Orchestrator — single public entry point that takes the user's
 * question + identity, runs it through the role taxonomy / guard /
 * router / brain stack, and returns the AdviseResponse.
 *
 * The orchestrator is deliberately the only place the ports are
 * called from. Routers + UI never touch the brain / data / audit
 * ports directly — that keeps the guard from being bypassed.
 *
 * Sequence:
 *
 *   1. Resolve persona from `user.role`. Unknown role → prospect.
 *   2. Classify intent + derive data needs.
 *   3. Fetch snippets through the data port (it may already be
 *      tenant-pinned but we re-check here defensively).
 *   4. Run `classifySnippets` against the role — partition into
 *      allowed / redacted / denied.
 *   5. Run the field-level redactor over the `redacted` group.
 *   6. Call the brain with the concatenated system prompt +
 *      allowed-and-redacted snippets.
 *   7. Synthesize follow-up suggestions (cheap, deterministic — same
 *      keyword scorer used by the router).
 *   8. Append one audit entry.
 */

import {
  classifySnippets,
  type Classification,
  type SnippetLike,
} from './data-access-guard.js';
import { getPersona, type Role } from './roles.js';
import { routeQuestion, type Intent, type SubAdvisorRoute } from './router.js';
import {
  redactFields,
  summariseRedactions,
  DEFAULT_PII_KEYS,
} from './redaction.js';
import {
  recordAudit,
  digestString,
  type AuditPort,
} from './audit.js';
import type { BrainPort, DataPort, DataSnippet, BrainCitation } from './ports.js';

export interface UserContext {
  readonly id: string;
  readonly tenantId: string;
  readonly role: Role;
  readonly displayName?: string;
}

export interface AdviseRequest {
  readonly user: UserContext;
  readonly question: string;
  readonly sessionId?: string;
}

export interface AdviseResponse {
  readonly answer: string;
  readonly intent: Intent;
  readonly answerId: string;
  readonly citations: ReadonlyArray<BrainCitation>;
  readonly suggestedFollowUps: ReadonlyArray<string>;
  readonly evidence: ReadonlyArray<{
    readonly id: string;
    readonly resource: string;
    readonly summary: string;
  }>;
  readonly redactedFields: ReadonlyArray<string>;
  readonly deniedSnippetIds: ReadonlyArray<string>;
}

export interface AdvisorDeps {
  readonly brain: BrainPort;
  readonly data: DataPort;
  readonly audit: AuditPort;
}

export interface AdvisorApi {
  advise(req: AdviseRequest): Promise<AdviseResponse>;
}

const DEPTH_TO_TOKENS: Record<'brief' | 'standard' | 'deep', number> = {
  brief: 200,
  standard: 600,
  deep: 1200,
};

export function createAdvisor(deps: AdvisorDeps): AdvisorApi {
  return {
    async advise(req: AdviseRequest): Promise<AdviseResponse> {
      const started = performance.now();
      const persona = getPersona(req.user.role);
      const route: SubAdvisorRoute = routeQuestion(req.question);

      // ─── Fetch + guard ──────────────────────────────────────────
      const fetched = await deps.data.fetchSnippets({
        role: req.user.role,
        tenantId: req.user.tenantId,
        userId: req.user.id,
        intent: route.intent,
        question: req.question,
        resourceNeeds: route.dataNeeds,
      });

      // Map DataSnippet → SnippetLike for the guard. The guard works
      // off the structural fields so this is just type narrowing.
      const classified: Classification<DataSnippet & SnippetLike> =
        classifySnippets(req.user.role, fetched as ReadonlyArray<DataSnippet & SnippetLike>, req.user.tenantId);

      // Redact the middle bucket. We redact both the `summary` and
      // `body` strings AND the underlying `data` blob so the brain
      // can't recover PII from either path.
      const redactedSnippets = classified.redacted.map((s) => {
        const redactedData = s.data
          ? redactFields(s.data, DEFAULT_PII_KEYS, { reason: 'pii' })
          : undefined;
        const summary = redactString(s.summary);
        const body = s.body ? redactString(s.body) : undefined;
        return { ...s, summary, body, data: redactedData } as DataSnippet;
      });

      const allRedactionKeys = new Set<string>();
      for (let i = 0; i < classified.redacted.length; i++) {
        const before = classified.redacted[i]!;
        const after = redactedSnippets[i]!;
        const keys = summariseRedactions(
          before.data ?? {},
          after.data ?? {},
          DEFAULT_PII_KEYS,
        );
        for (const k of keys) allRedactionKeys.add(k);
      }

      const toBrainCtx = (s: DataSnippet) => {
        // `exactOptionalPropertyTypes` rejects `body: undefined`. Build
        // the object via conditional spread so the key is absent when
        // we have no body to send.
        const base = { id: s.id, resource: s.resource, summary: s.summary };
        return s.body !== undefined ? { ...base, body: s.body } : base;
      };
      const contextSnippets = [
        ...classified.allowed.map(toBrainCtx),
        ...redactedSnippets.map(toBrainCtx),
      ];

      // ─── Brain call ────────────────────────────────────────────
      const systemPrompt = buildSystemPrompt(persona.systemPrompt, route);
      const maxTokens = DEPTH_TO_TOKENS[persona.defaultDepth];

      // When every snippet was denied AND the question was clearly
      // asking for own/tenant data (lease, maintenance, market about
      // own portfolio), short-circuit with a polite refusal so we
      // don't burn brain tokens hallucinating an answer.
      const askingForData =
        route.intent === 'lease-question' ||
        route.intent === 'maintenance-question' ||
        (route.isSubAdvisor && classified.denied.length > 0);
      const onlyDenials =
        classified.allowed.length === 0 && classified.redacted.length === 0;

      let answerText: string;
      let citations: ReadonlyArray<BrainCitation>;
      if (
        askingForData &&
        onlyDenials &&
        classified.denied.length > 0
      ) {
        answerText = buildRefusal(req.user.role);
        citations = [];
      } else {
        const brainRes = await deps.brain.respond({
          systemPrompt,
          question: req.question,
          contextSnippets,
          maxTokens,
        });
        answerText = brainRes.text;
        citations = brainRes.citations;
      }

      const answerId = `ans_${digestString(`${req.user.id}|${Date.now()}|${req.question}`)}`;
      const followUps = generateFollowUps(route.intent, req.user.role);
      const evidence = contextSnippets.map((s) => ({
        id: s.id,
        resource: s.resource as string,
        summary: s.summary,
      }));
      const redactedFields = [...allRedactionKeys];
      const deniedSnippetIds = classified.denied.map((s) => s.id);

      // ─── Audit ─────────────────────────────────────────────────
      await recordAudit(deps.audit, {
        at: new Date().toISOString(),
        action: 'advisor.ask',
        tenantId: req.user.tenantId,
        userId: req.user.id,
        role: req.user.role,
        sessionId: req.sessionId ?? null,
        intent: route.intent,
        question: req.question,
        answerDigest: digestString(answerText),
        answerId,
        redactedFields,
        deniedSnippetIds,
        latencyMs: Math.round(performance.now() - started),
        outcome: 'ok',
        detail: {
          allowedSnippetCount: classified.allowed.length,
          redactedSnippetCount: redactedSnippets.length,
          deniedSnippetCount: classified.denied.length,
        },
      });

      return {
        answer: answerText,
        intent: route.intent,
        answerId,
        citations,
        suggestedFollowUps: followUps,
        evidence,
        redactedFields,
        deniedSnippetIds,
      };
    },
  };
}

function buildSystemPrompt(
  personaPrompt: string,
  route: SubAdvisorRoute,
): string {
  const routeHint = route.isSubAdvisor
    ? `Hand off to the ${route.intent} sub-advisor logic.`
    : `Answer using the brain directly for intent '${route.intent}'.`;
  return `${personaPrompt}\n\n${routeHint}`;
}

function buildRefusal(role: Role): string {
  // Calibrated per role — tenants get a warmer refusal than admins.
  if (role === 'tenant') {
    return "I can only discuss your own records. If you're asking about another unit, please ask the resident there to share it with you directly.";
  }
  if (role === 'prospect') {
    return "I can only share information about publicly listed units. Sign up to discuss your own tenancy questions.";
  }
  return 'Access denied — the data you requested falls outside your role scope. If you believe this is in error, contact your administrator.';
}

function redactString(input: string): string {
  // Cheap heuristic over visible PII in summary strings. We aren't
  // trying to be perfect; the structured `data` field is the source
  // of truth and is already redacted by `redactFields`. This is
  // belt-and-braces for the human-readable summaries.
  return input
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, '[redacted: pii]')
    .replace(/\b(?:\+?\d{1,3}[ -]?)?(?:\(\d{1,4}\)|\d{1,4})[ -]?\d{3,4}[ -]?\d{3,4}\b/g, '[redacted: pii]');
}

function generateFollowUps(intent: Intent, role: Role): ReadonlyArray<string> {
  const ROLE_TUNED: Partial<Record<Intent, Partial<Record<Role, string[]>>>> = {
    'lease-question': {
      tenant: [
        'What is the best way to start a renewal conversation?',
        'Are there hidden fees I should look out for?',
      ],
      owner: [
        'What is a fair concession to offer this renewal?',
        'How does this rent compare to local market rate?',
      ],
      'property-manager': [
        'Draft a renewal letter for this tenant.',
        'Which tenants in my portfolio are highest renewal risk?',
      ],
    },
    'maintenance-question': {
      tenant: [
        'How can I escalate if the response is too slow?',
        'What can I do in the meantime to prevent damage?',
      ],
      'property-manager': [
        'Which vendor has the best SLA in this category?',
        'How much should this typically cost?',
      ],
    },
    'market-question': {
      owner: [
        'Should I raise rents at next renewal?',
        'Which submarket is appreciating fastest?',
      ],
      tenant: [
        'Is my landlord likely to raise rent next year?',
        'How do my unit features compare?',
      ],
    },
    sustainability: {
      owner: [
        'What is the payback period for solar on this property?',
        'Which upgrades qualify for green-finance discounts?',
      ],
    },
  };
  return (
    ROLE_TUNED[intent]?.[role] ?? [
      'Tell me more about this.',
      'What is the most important action to take next?',
    ]
  );
}
