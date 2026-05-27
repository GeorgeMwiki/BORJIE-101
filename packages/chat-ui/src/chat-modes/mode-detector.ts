/**
 * Chat Mode Detector (BORJIE estate-management edition)
 *
 * Zero-LLM pattern analysis. Port of LitFin's mode detector, re-keyed
 * for estate-management training vocabulary (rent affordability,
 * arrears, lease, maintenance, tenancy risk, 5 Ps).
 *
 * Rules:
 *  - Quiz indicators + A/B/C/D options   -> quiz
 *  - Teaching tool invoked or indicators -> teaching
 *  - Multi-user session context          -> classroom
 *  - Review/summary indicators present   -> review
 *  - Discussion keywords + group context -> discussion
 *  - Default: stay in the current mode   (conversation)
 */

import type {
  ChatMode,
  TeachingModeData,
  QuizLockdownData,
  ReviewModeData,
  BloomLevel,
} from './types';

const QUIZ_INDICATORS: readonly RegExp[] = [
  /let me test your (understanding|knowledge)/i,
  /quiz time/i,
  /answer the following/i,
  /which of the following/i,
  /select the (correct|best|right) (answer|option)/i,
  /\b[A-D]\)\s/,
  /option [A-D]:/i,
  /what is the (correct|best|right) answer/i,
  /choose one/i,
  /multiple choice/i,
];

const TEACHING_INDICATORS: readonly RegExp[] = [
  /let me (explain|teach|walk you through)/i,
  /key points? (about|regarding|on|for)/i,
  /here('s| is) (what|how) .{5,40} works/i,
  /concept:?\s/i,
  /understanding .{3,40}:/i,
  /in (simple|plain) terms/i,
  /the (main|key|important) (idea|concept|point)/i,
  /bloom('s)? (level|taxonomy)/i,
  /let('s| us) (learn|explore|understand)/i,
  /fundamentals of (property|tenancy|lease|rent|maintenance|estate)/i,
  /(rent affordability|arrears|security deposit|5 ?p'?s|tenancy risk)/i,
];

const REVIEW_INDICATORS: readonly RegExp[] = [
  /your (score|results|performance|mastery)/i,
  /you('ve| have) (mastered|completed|achieved|scored)/i,
  /session (summary|review|results)/i,
  /mastery.{0,20}(increased|improved|reached)/i,
  /tenancy readiness score/i,
  /five ?p'?s.{0,20}(score|analysis|assessment)/i,
  /readiness.{0,20}(score|level|assessment)/i,
  /your progress/i,
  /misconceptions?.{0,20}(addressed|fixed|corrected)/i,
  /bloom('s)? level.{0,20}reached/i,
];

const DISCUSSION_INDICATORS: readonly RegExp[] = [
  /let('s| us) discuss/i,
  /what (do you|are your) (think|thoughts)/i,
  /open (the )?(discussion|floor)/i,
  /share your (thoughts|opinion|perspective)/i,
  /debate/i,
  /group discussion/i,
];

function countPatternMatches(
  text: string,
  patterns: readonly RegExp[],
): number {
  let count = 0;
  for (const pattern of patterns) {
    if (pattern.test(text)) count += 1;
  }
  return count;
}

export interface ModeDetectionInput {
  readonly responseText: string;
  readonly toolCalls: readonly string[];
  readonly currentMode: ChatMode;
  readonly isGroupSession: boolean;
  readonly sessionMessageCount: number;
}

export interface ModeDetectionResult {
  readonly suggestedMode: ChatMode;
  readonly confidence: number;
  readonly reason: string;
}

/**
 * Detect the best chat mode based on AI response content.
 * Returns the suggested mode with a confidence score (0-1).
 * Never changes mode in the first 2 messages (warm-up window).
 */
export function detectModeFromResponse(
  input: ModeDetectionInput,
): ModeDetectionResult {
  const {
    responseText,
    toolCalls,
    currentMode,
    isGroupSession,
    sessionMessageCount,
  } = input;

  if (sessionMessageCount < 2) {
    return {
      suggestedMode: 'conversation',
      confidence: 1.0,
      reason: 'Session warm-up',
    };
  }

  if (
    toolCalls.includes('teach-concept') ||
    toolCalls.includes('explain-concept')
  ) {
    return {
      suggestedMode: 'teaching',
      confidence: 0.95,
      reason: 'Teaching tool invoked',
    };
  }
  if (
    toolCalls.includes('assess-knowledge') ||
    toolCalls.includes('generate-quiz')
  ) {
    return {
      suggestedMode: 'quiz',
      confidence: 0.95,
      reason: 'Assessment tool invoked',
    };
  }
  if (toolCalls.includes('set-chat-mode')) {
    return {
      suggestedMode: currentMode,
      confidence: 1.0,
      reason: 'Explicit mode set',
    };
  }

  const quizScore = countPatternMatches(responseText, QUIZ_INDICATORS);
  const teachingScore = countPatternMatches(responseText, TEACHING_INDICATORS);
  const reviewScore = countPatternMatches(responseText, REVIEW_INDICATORS);
  const discussionScore = countPatternMatches(responseText, DISCUSSION_INDICATORS);

  const hasOptions =
    /\b[A-D]\)\s/.test(responseText) || /option [A-D]:/i.test(responseText);
  if (quizScore >= 2 && hasOptions) {
    return {
      suggestedMode: 'quiz',
      confidence: 0.85,
      reason: 'Quiz pattern detected with options',
    };
  }

  if (teachingScore >= 2) {
    return {
      suggestedMode: 'teaching',
      confidence: 0.75,
      reason: 'Teaching pattern detected',
    };
  }

  if (reviewScore >= 2) {
    return {
      suggestedMode: 'review',
      confidence: 0.8,
      reason: 'Review/results pattern detected',
    };
  }

  if (
    (isGroupSession && discussionScore >= 2) ||
    (!isGroupSession && discussionScore >= 3)
  ) {
    return {
      suggestedMode: 'discussion',
      confidence: isGroupSession ? 0.7 : 0.65,
      reason: isGroupSession
        ? 'Discussion pattern in group session'
        : 'Strong discussion pattern in solo session',
    };
  }

  if (isGroupSession && currentMode === 'classroom') {
    return {
      suggestedMode: 'classroom',
      confidence: 0.9,
      reason: 'Active group session',
    };
  }

  return {
    suggestedMode: currentMode,
    confidence: 0.5,
    reason: 'No strong mode signal',
  };
}

/** Extract teaching data (key points, bloom level) from a streamed AI response. */
export function extractTeachingData(
  responseText: string,
): Partial<TeachingModeData> {
  const keyPoints: string[] = [];
  const bulletMatches = responseText.match(/^[-*]\s+(.+)$/gm);
  if (bulletMatches) {
    for (const match of bulletMatches.slice(0, 5)) {
      keyPoints.push(match.replace(/^[-*]\s+/, '').trim());
    }
  }

  const bloomMatch = responseText.match(
    /bloom('s)?\s*(level|taxonomy)?\s*:?\s*(remember|understand|apply|analyze|evaluate|create)/i,
  );
  const bloomLevel: BloomLevel =
    bloomMatch && bloomMatch[3]
      ? (bloomMatch[3].toLowerCase() as BloomLevel)
      : 'understand';

  return {
    keyPoints,
    keyPointsSw: [],
    bloomLevel,
    isStreaming: false,
  };
}

/** Extract quiz data from a response that contains A/B/C/D option patterns. */
export function extractQuizData(
  responseText: string,
): Partial<QuizLockdownData> | null {
  const options: { id: string; label: string; labelSw: null }[] = [];
  const pattern = /([A-D])\)\s*(.+?)(?=\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(responseText)) !== null) {
    const idGroup = match[1];
    const labelGroup = match[2];
    if (!idGroup || !labelGroup) continue;
    options.push({
      id: idGroup.toUpperCase(),
      label: labelGroup.trim(),
      labelSw: null,
    });
  }

  if (options.length < 2) return null;

  const firstOptionIndex = responseText.search(/[A-D]\)\s/);
  const question =
    firstOptionIndex > 0
      ? responseText
          .slice(0, firstOptionIndex)
          .trim()
          .split('\n')
          .pop()
          ?.trim() ?? ''
      : '';

  return {
    questionId: `q-${Date.now()}`,
    question,
    questionSw: null,
    options,
    timeLimitSeconds: 30,
    timeRemainingSeconds: 30,
    difficulty: 'basic',
    bloomLevel: 'understand',
    pointsValue: 10,
    answeredCount: 0,
    totalParticipants: 1,
    timeExtended: false,
  };
}

/** Extract review data (overall score, mastery delta) from an AI summary response. */
export function extractReviewData(
  responseText: string,
): Partial<ReviewModeData> {
  const scoreMatch = responseText.match(/(\d{1,3})\s*(%|percent|out of 100)/i);
  const score = scoreMatch && scoreMatch[1] ? parseInt(scoreMatch[1], 10) : 0;

  const deltaMatch = responseText.match(
    /(?:increased|improved)(?: by)? \+?(\d{1,3})%/i,
  );
  const masteryDelta =
    deltaMatch && deltaMatch[1] ? parseInt(deltaMatch[1], 10) / 100 : 0;

  return {
    overallScore: score,
    masteryDelta,
    conceptsCovered: 0,
    quizAccuracy: 0,
    bloomLevelReached: 'understand',
    misconceptionsAddressed: 0,
    recommendedNextConcepts: [],
    recommendedReviewDate: null,
  };
}

/** Decide whether to extend quiz time based on group answer progress. */
export function shouldExtendQuizTime(data: QuizLockdownData): boolean {
  if (data.timeExtended) return false;
  if (data.totalParticipants <= 1) return false;
  const answerRate = data.answeredCount / data.totalParticipants;
  const timeRate = data.timeRemainingSeconds / data.timeLimitSeconds;
  return answerRate < 0.6 && timeRate < 0.3;
}
