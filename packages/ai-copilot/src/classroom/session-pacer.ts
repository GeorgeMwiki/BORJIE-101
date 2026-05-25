/**
 * Session pacer (Wave 11).
 *
 * Given the current BKT snapshot + engagement snapshot, emits a pacing
 * decision that the AI Professor should follow.
 *
 * Output decisions:
 *   - `keep_going`   — everything on track, continue with current plan
 *   - `re_explain`   — mastery low, revisit the concept with simpler framing
 *   - `switch_mode`  — move to a different activity (quiz ↔ discussion ↔ peer_teach)
 *   - `take_break`   — engagement too low, pause
 *
 * Pure, deterministic — consumes group mastery + engagement aggregates.
 */

import type { GroupConceptMastery, LearnerBKT } from './group-bkt.js';
import { calculateGroupConceptMastery } from './group-bkt.js';
import type { EngagementVerdict } from './engagement-detector.js';
import { aggregateEngagement } from './engagement-detector.js';

export type PaceDecision =
  | 'keep_going'
  | 're_explain'
  | 'switch_mode'
  | 'take_break';

export interface PacerInput {
  readonly learners: readonly LearnerBKT[];
  readonly currentConceptId: string;
  readonly engagement: readonly EngagementVerdict[];
  readonly minutesIntoSession: number;
  readonly currentMode?: 'teach' | 'quiz' | 'discuss' | 'peer_teach';
}

export interface PacerOutput {
  readonly decision: PaceDecision;
  readonly reason: string;
  readonly suggestedMode?: 'teach' | 'quiz' | 'discuss' | 'peer_teach';
  readonly mastery: GroupConceptMastery;
  readonly engagementSummary: ReturnType<typeof aggregateEngagement>;
}

export function decidePacing(input: PacerInput): PacerOutput {
  const mastery = calculateGroupConceptMastery(
    input.learners,
    input.currentConceptId
  );
  const engagementSummary = aggregateEngagement(input.engagement);

  // Rule 1: disengagement majority → break
  if (
    input.engagement.length > 0 &&
    engagementSummary.disengagedCount >= input.engagement.length / 2
  ) {
    return {
      decision: 'take_break',
      reason: 'Majority of learners are disengaged',
      mastery,
      engagementSummary,
    };
  }

  // Rule 2: long session (>45 min) and avg engagement < 0.6 → break
  if (
    input.minutesIntoSession > 45 &&
    engagementSummary.avgScore < 0.6
  ) {
    return {
      decision: 'take_break',
      reason: 'Attention fatigue after extended session',
      mastery,
      engagementSummary,
    };
  }

  // Rule 3: low mastery after enough observations → re-explain
  if (mastery.learnerCount >= 2 && mastery.groupPKnow < 0.35) {
    return {
      decision: 're_explain',
      reason: 'Group mastery too low to proceed',
      mastery,
      engagementSummary,
    };
  }

  // Rule 4: high spread + high max → peer-teach mode
  if (mastery.peerLearningOpportunity && input.currentMode !== 'peer_teach') {
    return {
      decision: 'switch_mode',
      reason: 'Strong knowledge diversity — peer teaching will help lagging learners',
      suggestedMode: 'peer_teach',
      mastery,
      engagementSummary,
    };
  }

  // Rule 5: high mastery + currently teaching → switch to quiz
  if (
    mastery.groupPKnow >= 0.7 &&
    mastery.learnerCount > 0 &&
    input.currentMode === 'teach'
  ) {
    return {
      decision: 'switch_mode',
      reason: 'Group ready — move from teaching to quiz',
      suggestedMode: 'quiz',
      mastery,
      engagementSummary,
    };
  }

  // Rule 6: mastered → advance (still keep_going; caller picks next concept)
  if (mastery.groupPKnow >= 0.95) {
    return {
      decision: 'keep_going',
      reason: 'Concept mastered — advance to next concept',
      mastery,
      engagementSummary,
    };
  }

  return {
    decision: 'keep_going',
    reason: 'On track',
    mastery,
    engagementSummary,
  };
}
