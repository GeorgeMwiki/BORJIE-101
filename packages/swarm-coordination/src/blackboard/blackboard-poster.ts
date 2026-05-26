/**
 * Blackboard poster — write a contribution to the shared workspace.
 *
 * Wave 18HH. Validates the input against the SQL CHECK enumeration
 * for `contribution_kind` and enforces the spec discipline that a
 * `plan` posted against a subject MUST supersede any earlier
 * unsuperseded `plan` posting against the same subject (this guards
 * against the §10 anti-pattern of ambiguous-plan accumulation).
 *
 * The supersedes check is *advisory* — the poster is responsible for
 * supplying `supersedesPostingId`. If a new `plan` is posted without
 * one, but a prior plan exists, this module returns a warning to the
 * caller alongside the row. The caller decides whether to fail-fast.
 */

import { z } from 'zod';
import type {
  AgentSubject,
  BlackboardPosting,
  BlackboardRepository,
  PostContributionInput,
} from '../types.js';

const postInputSchema = z.object({
  tenantId: z.string().min(1),
  postedByAgentId: z.string().min(1),
  subject: z.object({
    kind: z.string().min(1),
    id: z.string().min(1),
    summary: z.string().optional(),
  }),
  contributionKind: z.enum([
    'observation',
    'hypothesis',
    'question',
    'plan',
    'result',
  ]),
  payload: z.record(z.unknown()),
  scopeId: z.string().optional(),
  supersedesPostingId: z.string().uuid().optional(),
});

export type ValidatedPostInput = z.infer<typeof postInputSchema>;

function toAgentSubject(parsed: {
  readonly kind: string;
  readonly id: string;
  readonly summary?: string | undefined;
}): AgentSubject {
  return {
    kind: parsed.kind,
    id: parsed.id,
    ...(parsed.summary !== undefined ? { summary: parsed.summary } : {}),
  };
}

export interface BlackboardPostResult {
  readonly posting: BlackboardPosting;
  readonly warning: string | null;
}

export interface BlackboardPoster {
  post(input: ValidatedPostInput): Promise<BlackboardPostResult>;
}

export function createBlackboardPoster(
  repository: BlackboardRepository,
): BlackboardPoster {
  return {
    async post(rawInput) {
      const input = postInputSchema.parse(rawInput);
      const subject = toAgentSubject(input.subject);
      const postInput: PostContributionInput = {
        tenantId: input.tenantId,
        postedByAgentId: input.postedByAgentId,
        subject,
        contributionKind: input.contributionKind,
        payload: input.payload,
        ...(input.scopeId !== undefined ? { scopeId: input.scopeId } : {}),
        ...(input.supersedesPostingId !== undefined
          ? { supersedesPostingId: input.supersedesPostingId }
          : {}),
      };

      let warning: string | null = null;
      if (
        input.contributionKind === 'plan' &&
        input.supersedesPostingId === undefined
      ) {
        const existing = await repository.readSubject(
          input.tenantId,
          subject,
          input.scopeId,
        );
        const unsupersededPlan = existing.find(
          (p) =>
            p.contributionKind === 'plan' &&
            !existing.some((q) => q.supersedesPostingId === p.id),
        );
        if (unsupersededPlan !== undefined) {
          warning =
            'A prior unsuperseded plan exists for this subject; ' +
            'consider supplying supersedesPostingId to maintain lineage.';
        }
      }

      const posting = await repository.post(postInput);
      return Object.freeze({ posting, warning });
    },
  };
}
