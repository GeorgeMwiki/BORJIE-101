/**
 * Classroom + BKT tests (Wave 11).
 */

import { describe, it, expect } from 'vitest';
import {
  initBKT,
  updateBKT,
  isMastered,
  calculateGroupConceptMastery,
  calculateOverallGroupMastery,
  type LearnerBKT,
} from '../classroom/group-bkt.js';
import {
  ESTATE_CONCEPTS,
  getConcept,
  prerequisitesMet,
  topoSortConcepts,
} from '../classroom/concepts-catalog.js';
import {
  createSession,
  transitionState,
  addParticipant,
  recordQuizAnswer,
  assertTenantOwnership,
  SessionStateError,
} from '../classroom/session-manager.js';
import {
  detectEngagement,
  aggregateEngagement,
} from '../classroom/engagement-detector.js';
import { decidePacing } from '../classroom/session-pacer.js';
import { planBreakout } from '../classroom/breakout-manager.js';
import {
  createQuestionOrchestrator,
  pickBloomForPKnow,
  pickDifficultyForPKnow,
} from '../classroom/question-orchestrator.js';
import { createSessionRecorder } from '../classroom/session-recorder.js';

// --- BKT math -------------------------------------------------------------

describe('BKT update math', () => {
  it('correct answer increases pKnow', () => {
    const s0 = initBKT({ pKnow: 0.3 });
    const s1 = updateBKT(s0, true);
    expect(s1.pKnow).toBeGreaterThan(s0.pKnow);
    expect(s1.observations).toBe(1);
  });
  it('incorrect answer decreases pKnow', () => {
    const s0 = initBKT({ pKnow: 0.6 });
    const s1 = updateBKT(s0, false);
    expect(s1.pKnow).toBeLessThan(s0.pKnow);
  });
  it('pKnow stays in [0,1]', () => {
    let s = initBKT({ pKnow: 0.99 });
    for (let i = 0; i < 10; i++) s = updateBKT(s, true);
    expect(s.pKnow).toBeGreaterThan(0);
    expect(s.pKnow).toBeLessThanOrEqual(1);
  });
  it('isMastered true after many correct answers', () => {
    let s = initBKT();
    for (let i = 0; i < 12; i++) s = updateBKT(s, true);
    expect(isMastered(s)).toBe(true);
  });
});

// --- Group aggregation ----------------------------------------------------

describe('Group BKT aggregation', () => {
  it('calculates groupPKnow as weighted average', () => {
    const learners: LearnerBKT[] = [
      { userId: 'a', concepts: { c1: { ...initBKT(), pKnow: 0.8, observations: 10 } } },
      { userId: 'b', concepts: { c1: { ...initBKT(), pKnow: 0.2, observations: 2 } } },
    ];
    const m = calculateGroupConceptMastery(learners, 'c1');
    expect(m.groupPKnow).toBeGreaterThan(0.5);
    expect(m.minPKnow).toBe(0.2);
    expect(m.maxPKnow).toBe(0.8);
    expect(m.spread).toBeCloseTo(0.6);
    expect(m.peerLearningOpportunity).toBe(true);
  });
  it('overall group mastery is average across concepts', () => {
    const learners: LearnerBKT[] = [
      { userId: 'a', concepts: { c1: { ...initBKT(), pKnow: 0.5 }, c2: { ...initBKT(), pKnow: 0.9 } } },
    ];
    const avg = calculateOverallGroupMastery(learners, ['c1', 'c2']);
    expect(avg).toBeCloseTo(0.7);
  });
});

// --- Concept catalog ------------------------------------------------------

describe('Concept catalog', () => {
  it('contains at least 30 estate-management concepts', () => {
    expect(ESTATE_CONCEPTS.length).toBeGreaterThanOrEqual(30);
  });
  it('returns null for unknown concept', () => {
    expect(getConcept('nope')).toBeNull();
  });
  it('prerequisitesMet respects the graph', () => {
    expect(prerequisitesMet('deposit_structures', [])).toBe(false);
    expect(prerequisitesMet('deposit_structures', ['rent_affordability'])).toBe(true);
  });
  it('topoSort orders prerequisites first', () => {
    const order = topoSortConcepts(['deposit_structures', 'rent_affordability']);
    expect(order.indexOf('rent_affordability')).toBeLessThan(
      order.indexOf('deposit_structures')
    );
  });
});

// --- Session manager ------------------------------------------------------

describe('Session manager lifecycle', () => {
  const baseInput = {
    id: 'ses_1',
    tenantId: 't1',
    createdBy: 'u-creator',
    title: 'Arrears training',
    targetConceptIds: ['arrears_ladder'],
  };

  it('creates session in idle state', () => {
    const s = createSession(baseInput);
    expect(s.state).toBe('idle');
    expect(s.targetConceptIds).toEqual(['arrears_ladder']);
  });

  it('transitions idle → active → ended', () => {
    let s = createSession(baseInput);
    s = transitionState(s, 'active');
    expect(s.state).toBe('active');
    s = transitionState(s, 'ended');
    expect(s.state).toBe('ended');
  });

  it('rejects invalid transitions', () => {
    const s = createSession(baseInput);
    expect(() => transitionState(s, 'paused')).toThrow(SessionStateError);
  });

  it('records a quiz answer — updates BKT', () => {
    let s = createSession(baseInput);
    s = addParticipant(s, {
      userId: 'u1',
      displayName: 'Amina',
      role: 'learner',
      joinedAt: new Date().toISOString(),
      isPresent: true,
    });
    s = recordQuizAnswer(s, { userId: 'u1', conceptId: 'arrears_ladder', isCorrect: true });
    const p = s.participants[0];
    expect(p.totalAnswers).toBe(1);
    expect(p.correctAnswers).toBe(1);
    expect(p.concepts['arrears_ladder'].pKnow).toBeGreaterThan(0.1);
    expect(s.coveredConcepts).toContain('arrears_ladder');
  });

  it('cross-tenant isolation — session for tenant A cannot be read by tenant B', () => {
    const s = createSession({ ...baseInput, tenantId: 'tA' });
    expect(() => assertTenantOwnership(s, 'tB')).toThrow(SessionStateError);
    expect(() => assertTenantOwnership(s, 'tA')).not.toThrow();
  });

  it('add-participant idempotent', () => {
    let s = createSession(baseInput);
    const p = {
      userId: 'u1',
      displayName: 'A',
      role: 'learner' as const,
      joinedAt: new Date().toISOString(),
      isPresent: true,
    };
    s = addParticipant(s, p);
    s = addParticipant(s, p);
    expect(s.participants).toHaveLength(1);
  });
});

// --- Engagement detector --------------------------------------------------

describe('Engagement detector', () => {
  it('engaged when no signals', () => {
    const v = detectEngagement({ userId: 'u' });
    expect(v.level).toBe('engaged');
  });
  it('disengaged on every bad signal combined', () => {
    const v = detectEngagement({
      userId: 'u',
      silentForMs: 120_000,
      accuracyWindow: 0.1,
      lastAnswerLatencyMs: 30_000,
      offTopicFlags: 3,
    });
    expect(v.level).toBe('disengaged');
  });
  it('distracted on silence + low accuracy only', () => {
    const v = detectEngagement({
      userId: 'u',
      silentForMs: 120_000,
      accuracyWindow: 0.1,
    });
    expect(v.level).toBe('distracted');
  });
  it('aggregate counts by level', () => {
    const agg = aggregateEngagement([
      { userId: 'a', level: 'engaged', reasons: [], score: 0.9 },
      { userId: 'b', level: 'disengaged', reasons: [], score: 0.2 },
    ]);
    expect(agg.engagedCount).toBe(1);
    expect(agg.disengagedCount).toBe(1);
  });
});

// --- Pacer ----------------------------------------------------------------

describe('Session pacer', () => {
  it('take_break when majority disengaged', () => {
    const out = decidePacing({
      learners: [],
      currentConceptId: 'arrears_ladder',
      engagement: [
        { userId: 'a', level: 'disengaged', reasons: [], score: 0.2 },
        { userId: 'b', level: 'disengaged', reasons: [], score: 0.2 },
      ],
      minutesIntoSession: 10,
    });
    expect(out.decision).toBe('take_break');
  });
  it('re_explain on low mastery', () => {
    const learners: LearnerBKT[] = [
      { userId: 'a', concepts: { c: { ...initBKT(), pKnow: 0.2, observations: 3 } } },
      { userId: 'b', concepts: { c: { ...initBKT(), pKnow: 0.15, observations: 3 } } },
    ];
    const out = decidePacing({
      learners,
      currentConceptId: 'c',
      engagement: [],
      minutesIntoSession: 10,
    });
    expect(out.decision).toBe('re_explain');
  });
  it('switch_mode to peer_teach when diversity is high', () => {
    const learners: LearnerBKT[] = [
      { userId: 'a', concepts: { c: { ...initBKT(), pKnow: 0.95, observations: 5 } } },
      { userId: 'b', concepts: { c: { ...initBKT(), pKnow: 0.2, observations: 3 } } },
    ];
    const out = decidePacing({
      learners,
      currentConceptId: 'c',
      engagement: [],
      minutesIntoSession: 5,
    });
    expect(out.decision).toBe('switch_mode');
    expect(out.suggestedMode).toBe('peer_teach');
  });
});

// --- Breakout manager -----------------------------------------------------

describe('Breakout manager', () => {
  it('splits by mastery', () => {
    const learners: LearnerBKT[] = [
      { userId: 'a', concepts: { c: { ...initBKT(), pKnow: 0.9 } } },
      { userId: 'b', concepts: { c: { ...initBKT(), pKnow: 0.8 } } },
      { userId: 'c', concepts: { c: { ...initBKT(), pKnow: 0.3 } } },
      { userId: 'd', concepts: { c: { ...initBKT(), pKnow: 0.2 } } },
    ];
    const plan = planBreakout({
      learners,
      conceptId: 'c',
      groupSize: 2,
      strategy: 'by_mastery',
    });
    expect(plan.groups).toHaveLength(2);
    expect(plan.groups[0].learners).toEqual(['a', 'b']);
    expect(plan.groups[1].learners).toEqual(['c', 'd']);
  });
  it('mixed ability distributes leaders', () => {
    const learners: LearnerBKT[] = [
      { userId: 'hi', concepts: { c: { ...initBKT(), pKnow: 0.95 } } },
      { userId: 'lo1', concepts: { c: { ...initBKT(), pKnow: 0.1 } } },
      { userId: 'lo2', concepts: { c: { ...initBKT(), pKnow: 0.1 } } },
      { userId: 'lo3', concepts: { c: { ...initBKT(), pKnow: 0.1 } } },
    ];
    const plan = planBreakout({
      learners,
      conceptId: 'c',
      groupSize: 2,
      strategy: 'mixed_ability',
    });
    expect(plan.groups.length).toBeGreaterThan(0);
  });
  it('rejects groupSize < 2', () => {
    expect(() =>
      planBreakout({ learners: [], conceptId: 'c', groupSize: 1, strategy: 'random' })
    ).toThrow();
  });
});

// --- Question orchestrator -------------------------------------------------

describe('Question orchestrator', () => {
  it('picks difficulty based on pKnow', () => {
    expect(pickDifficultyForPKnow(0.1)).toBe('easy');
    expect(pickDifficultyForPKnow(0.5)).toBe('medium');
    expect(pickDifficultyForPKnow(0.8)).toBe('hard');
  });
  it('picks bloom target', () => {
    expect(pickBloomForPKnow(0.9, ['evaluate', 'create'])).toBe('evaluate');
  });
  it('parses JSON question from the ask fn', async () => {
    const orch = createQuestionOrchestrator({
      async ask() {
        return JSON.stringify({
          questionText: 'What is GePG?',
          choices: ['a', 'b', 'c', 'd'],
          correctIndex: 0,
          rationale: 'short',
        });
      },
    });
    const q = await orch.generateQuestionForConcept({
      conceptId: 'gepg_reconciliation',
      difficulty: 'medium',
      bloomLevel: 'apply',
      language: 'en',
      learnerId: 'u',
    });
    expect(q.questionText).toContain('GePG');
    expect(q.choices).toHaveLength(4);
    expect(q.correctIndex).toBe(0);
  });
  it('falls back to plain text when JSON parse fails', async () => {
    const orch = createQuestionOrchestrator({
      async ask() {
        return 'Not JSON';
      },
    });
    const q = await orch.generateQuestionForConcept({
      conceptId: 'gepg_reconciliation',
      difficulty: 'easy',
      bloomLevel: 'remember',
      language: 'en',
      learnerId: 'u',
    });
    expect(q.questionText).toBe('Not JSON');
  });
});

// --- Session recorder ------------------------------------------------------

describe('Session recorder', () => {
  it('appends transcripts immutably', () => {
    let rec = createSessionRecorder({ sessionId: 's1', tenantId: 't1' });
    const first = rec;
    rec = rec.append({
      participantId: 'u',
      role: 'learner',
      text: 'hi',
      language: 'en',
    });
    expect(first.record.entries).toHaveLength(0);
    expect(rec.record.entries).toHaveLength(1);
    expect(rec.record.entries[0].text).toBe('hi');
  });
});
