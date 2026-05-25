/**
 * Tiny in-test doubles for the brain / audit / userContext ports.
 *
 * Kept separate from the production code so the package's runtime
 * surface stays clean. None of these are exported from `src/index.ts`.
 */

import type {
  BrainPort,
  BrainCoachPort,
  BrainStructuredReview,
  CoachingMessage,
  ReviewAuditPort,
  ReviewAuditRecord,
  UserContextPort,
} from '../types.js';

export interface FakeBrain extends BrainPort {
  readonly calls: ReadonlyArray<{ systemPrompt: string; question: string }>;
}

export function fakeBrain(response: BrainStructuredReview | (() => BrainStructuredReview)): FakeBrain {
  const calls: Array<{ systemPrompt: string; question: string }> = [];
  return {
    calls,
    async respond(args) {
      calls.push({ systemPrompt: args.systemPrompt, question: args.question });
      return typeof response === 'function' ? response() : response;
    },
  };
}

export function fakeBrainThrowing(error: Error): BrainPort {
  return {
    async respond() {
      throw error;
    },
  };
}

export function fakeBrainReturningRaw(raw: unknown): BrainPort {
  return {
    async respond() {
      return raw as BrainStructuredReview;
    },
  };
}

export interface FakeAudit extends ReviewAuditPort {
  readonly records: ReadonlyArray<ReviewAuditRecord>;
}

export function fakeAudit(): FakeAudit {
  const records: ReviewAuditRecord[] = [];
  return {
    records,
    async recordReview(record) {
      records.push(record);
    },
  };
}

export function fakeAuditThrowing(): ReviewAuditPort {
  return {
    async recordReview() {
      throw new Error('audit_write_failed');
    },
  };
}

export interface FakeCoachBrain extends BrainCoachPort {
  readonly calls: ReadonlyArray<{ systemPrompt: string; question: string }>;
}

export function fakeCoachBrain(
  response: ReadonlyArray<CoachingMessage>,
): FakeCoachBrain {
  const calls: Array<{ systemPrompt: string; question: string }> = [];
  return {
    calls,
    async coach(args) {
      calls.push({ systemPrompt: args.systemPrompt, question: args.question });
      return response;
    },
  };
}

export function fakeUserContext(
  snippets: ReadonlyArray<string>,
): UserContextPort {
  return {
    async fetchDossier() {
      return { snippets };
    },
  };
}
