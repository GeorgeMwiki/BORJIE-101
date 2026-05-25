/**
 * Coaching: surface hints on work-in-progress BEFORE the user submits.
 *
 * Heuristic-first: run the policy's pre-checks against the partial
 * payload and translate any non-blocking issues into hints. If the
 * partial state is too ambiguous (heuristics yield nothing AND the
 * payload has > MIN_FIELDS_FOR_LLM keys), fall back to the brain coach
 * port for a richer suggestion set.
 */

import type {
  BrainCoachPort,
  CoachingMessage,
  UserContextPort,
  WorkInProgress,
  ValidationIssue,
} from '../types.js';
import { coachingMessageSchema } from '../types.js';
import { policyFor } from '../policies/index.js';

const COACHING_SYSTEM_PROMPT =
  'You are a property-management coach. Given a work-in-progress payload, ' +
  'return a JSON array of CoachingMessage objects: ' +
  '{id, tone (hint|caution|block), title, body, field?, suggestedFix?}. ' +
  'Keep messages concise; prefer hints over blocks unless you are certain.';

const MIN_FIELDS_FOR_LLM = 1;

function severityToTone(severity: ValidationIssue['severity']): CoachingMessage['tone'] {
  switch (severity) {
    case 'critical':
      return 'block';
    case 'error':
      return 'caution';
    case 'warning':
      return 'caution';
    case 'info':
      return 'hint';
  }
}

export interface CoachArgs {
  readonly runInProgress: WorkInProgress;
  readonly brain?: BrainCoachPort;
  readonly userContext?: UserContextPort;
  readonly maxHints?: number;
}

export async function coachWorkInProgress(
  args: CoachArgs,
): Promise<ReadonlyArray<CoachingMessage>> {
  const { runInProgress, brain, userContext, maxHints = 5 } = args;
  const policy = policyFor(runInProgress.kind);

  // Heuristic pass: convert non-blocking validation issues into hints.
  const partialRequest = {
    kind: runInProgress.kind,
    payload: runInProgress.partialPayload,
    context: runInProgress.context,
  };
  const issues = policy.preChecks(partialRequest);

  const heuristicHints: CoachingMessage[] = issues.slice(0, maxHints).map((issue, i) => ({
    id: `heuristic_${runInProgress.kind}_${i}`,
    tone: severityToTone(issue.severity),
    title: issue.code,
    body: issue.message,
    ...(issue.field === undefined ? {} : { field: issue.field }),
    ...(issue.suggestedFix === undefined ? {} : { suggestedFix: issue.suggestedFix }),
  }));

  // If heuristics produced something, return early; coaching is meant
  // to be fast, and the LLM call is reserved for ambiguous cases.
  if (heuristicHints.length > 0) {
    return heuristicHints;
  }

  // Ambiguous: too few fields means the user hasn't typed anything;
  // skip the brain entirely.
  const payloadKeys = Object.keys(runInProgress.partialPayload).length;
  if (!brain || payloadKeys < MIN_FIELDS_FOR_LLM) {
    return [];
  }

  // Optional: fetch dossier snippets to ground the coach.
  let dossierBody = '';
  if (userContext) {
    try {
      const dossier = await userContext.fetchDossier({
        tenantId: runInProgress.context.tenantId,
        userId: runInProgress.context.actorUserId,
        intent: `coach_${runInProgress.kind}`,
      });
      dossierBody = dossier.snippets.join('\n');
    } catch {
      // Dossier failure is non-fatal — coaching proceeds without it.
    }
  }

  try {
    const raw = await brain.coach({
      systemPrompt: COACHING_SYSTEM_PROMPT,
      question: `Coach the user on this in-progress ${runInProgress.kind} payload. ${
        dossierBody ? `Relevant user context:\n${dossierBody}\n\n` : ''
      }Payload keys: ${Object.keys(runInProgress.partialPayload).join(', ')}.`,
      context: { kind: runInProgress.kind, payload: runInProgress.partialPayload },
      maxHints,
    });
    const validated: CoachingMessage[] = [];
    for (const item of raw) {
      const parsed = coachingMessageSchema.safeParse(item);
      if (parsed.success) {
        const msg: CoachingMessage = {
          id: parsed.data.id,
          tone: parsed.data.tone,
          title: parsed.data.title,
          body: parsed.data.body,
          ...(parsed.data.field === undefined ? {} : { field: parsed.data.field }),
          ...(parsed.data.suggestedFix === undefined
            ? {}
            : {
                suggestedFix: {
                  description: parsed.data.suggestedFix.description,
                  ...(parsed.data.suggestedFix.patch === undefined
                    ? {}
                    : { patch: parsed.data.suggestedFix.patch }),
                },
              }),
        };
        validated.push(msg);
      }
      if (validated.length >= maxHints) break;
    }
    return validated;
  } catch {
    // Coaching failures degrade silently — never block the user from typing.
    return [];
  }
}
