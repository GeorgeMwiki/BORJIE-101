/**
 * Classroom session manager (Wave 11).
 *
 * Pure, in-memory state machine:
 *   idle → active → (paused ↔ active) → ended
 *
 * Persistence is the caller's responsibility — this module only exposes
 * transition helpers that return a NEW session snapshot each time.
 */

import type { BKTState } from './group-bkt.js';
import { initBKT, updateBKT } from './group-bkt.js';

export type SessionState = 'idle' | 'active' | 'paused' | 'ended';

export interface Participant {
  readonly userId: string;
  readonly displayName: string;
  readonly role: 'instructor' | 'learner' | 'ai_professor';
  readonly joinedAt: string;
  readonly isPresent: boolean;
  readonly concepts: Readonly<Record<string, BKTState>>;
  readonly correctAnswers: number;
  readonly totalAnswers: number;
  readonly lastAnswerAt?: string;
}

export interface ClassroomSession {
  readonly id: string;
  readonly tenantId: string;
  readonly createdBy: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly state: SessionState;
  readonly targetConceptIds: readonly string[];
  readonly participants: readonly Participant[];
  readonly coveredConcepts: readonly string[];
}

export interface CreateSessionInput {
  readonly id: string;
  readonly tenantId: string;
  readonly createdBy: string;
  readonly title: string;
  readonly targetConceptIds: readonly string[];
  readonly now?: () => Date;
}

export function createSession(input: CreateSessionInput): ClassroomSession {
  const now = (input.now ?? (() => new Date()))().toISOString();
  return {
    id: input.id,
    tenantId: input.tenantId,
    createdBy: input.createdBy,
    title: input.title,
    createdAt: now,
    updatedAt: now,
    state: 'idle',
    targetConceptIds: [...input.targetConceptIds],
    participants: [],
    coveredConcepts: [],
  };
}

const VALID_TRANSITIONS: Readonly<Record<SessionState, readonly SessionState[]>> = {
  idle: ['active', 'ended'],
  active: ['paused', 'ended'],
  paused: ['active', 'ended'],
  ended: [],
};

export class SessionStateError extends Error {
  readonly code: 'INVALID_STATE' | 'NOT_FOUND';
  constructor(message: string, code: 'INVALID_STATE' | 'NOT_FOUND') {
    super(message);
    this.name = 'SessionStateError';
    this.code = code;
  }
}

export function transitionState(
  session: ClassroomSession,
  next: SessionState,
  now: Date = new Date()
): ClassroomSession {
  const allowed = VALID_TRANSITIONS[session.state];
  if (!allowed.includes(next)) {
    throw new SessionStateError(
      `Invalid transition ${session.state} → ${next}`,
      'INVALID_STATE'
    );
  }
  return {
    ...session,
    state: next,
    updatedAt: now.toISOString(),
  };
}

export function addParticipant(
  session: ClassroomSession,
  participant: Omit<Participant, 'concepts' | 'correctAnswers' | 'totalAnswers'>
): ClassroomSession {
  if (session.state === 'ended') {
    throw new SessionStateError(
      'Cannot add participant to ended session',
      'INVALID_STATE'
    );
  }
  if (session.participants.some((p) => p.userId === participant.userId)) {
    return session;
  }
  const withDefaults: Participant = {
    ...participant,
    concepts: {},
    correctAnswers: 0,
    totalAnswers: 0,
  };
  return {
    ...session,
    participants: [...session.participants, withDefaults],
    updatedAt: new Date().toISOString(),
  };
}

export function removeParticipant(
  session: ClassroomSession,
  userId: string
): ClassroomSession {
  return {
    ...session,
    participants: session.participants.filter((p) => p.userId !== userId),
    updatedAt: new Date().toISOString(),
  };
}

export interface QuizAnswerInput {
  readonly userId: string;
  readonly conceptId: string;
  readonly isCorrect: boolean;
  readonly answeredAt?: string;
}

/**
 * Apply a quiz answer to a session — updates the participant's BKT and the
 * covered-concepts list.
 */
export function recordQuizAnswer(
  session: ClassroomSession,
  input: QuizAnswerInput
): ClassroomSession {
  const idx = session.participants.findIndex((p) => p.userId === input.userId);
  if (idx === -1) {
    throw new SessionStateError(
      `Participant ${input.userId} not in session`,
      'NOT_FOUND'
    );
  }
  const participant = session.participants[idx];
  const prior = participant.concepts[input.conceptId] ?? initBKT();
  const nextState = updateBKT(prior, input.isCorrect);
  const nextConcepts = {
    ...participant.concepts,
    [input.conceptId]: nextState,
  };
  const nextParticipant: Participant = {
    ...participant,
    concepts: nextConcepts,
    correctAnswers: participant.correctAnswers + (input.isCorrect ? 1 : 0),
    totalAnswers: participant.totalAnswers + 1,
    lastAnswerAt: input.answeredAt ?? new Date().toISOString(),
  };
  const nextParticipants = [
    ...session.participants.slice(0, idx),
    nextParticipant,
    ...session.participants.slice(idx + 1),
  ];
  const coveredSet = new Set([...session.coveredConcepts, input.conceptId]);
  return {
    ...session,
    participants: nextParticipants,
    coveredConcepts: Array.from(coveredSet),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Extract this tenant's session — guard used by the router. Throws when the
 * session doesn't belong to the caller.
 */
export function assertTenantOwnership(
  session: ClassroomSession,
  tenantId: string
): void {
  if (session.tenantId !== tenantId) {
    throw new SessionStateError(
      `Session ${session.id} does not belong to tenant ${tenantId}`,
      'NOT_FOUND'
    );
  }
}
