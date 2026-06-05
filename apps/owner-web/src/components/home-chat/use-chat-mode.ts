'use client';

/**
 * useChatMode — pedagogical chat-mode reducer for HomeChatTeach.
 *
 * Mounts the `@borjie/chat-ui` chat-modes capability (previously an
 * orphaned package) onto the teaching surface. The brain-teach SSE stream
 * does not emit a discrete mode frame, so detection is content-driven
 * exactly as the package's `mode-detector` is designed for: when an
 * assistant turn completes we feed the accumulated reply text (plus any
 * inferred tool calls) through `detectModeFromResponse`, then hydrate the
 * matching per-mode data with the package's `extract*` helpers.
 *
 * Conversation stays the default: until a turn signals teaching / quiz /
 * review / discussion the state holds `mode: 'conversation'` and the host
 * renders nothing extra — additive and non-breaking.
 *
 * All transitions are immutable (new state objects, never mutation).
 */

import { useCallback, useMemo, useState } from 'react';
import {
  INITIAL_CHAT_MODE_STATE,
  detectModeFromResponse,
  extractTeachingData,
  extractQuizData,
  extractReviewData,
  type ChatMode,
  type ChatModeState,
  type TeachingModeData,
  type QuizLockdownData,
  type ReviewModeData,
  type DiscussionModeData,
} from '@borjie/chat-ui';

/** A completed assistant turn handed to the detector. */
export interface AssistantTurn {
  /** Full accumulated assistant reply text for the turn. */
  readonly responseText: string;
  /** Tool names the turn invoked, if the host can infer any. */
  readonly toolCalls: readonly string[];
  /** Total messages exchanged so far (warm-up gating lives in the detector). */
  readonly sessionMessageCount: number;
}

export interface UseChatModeResult {
  readonly state: ChatModeState;
  /** Detect + apply a mode from a finished assistant turn. */
  readonly ingestAssistantTurn: (turn: AssistantTurn) => void;
  /** Revert to a target mode (e.g. quiz overlay → teaching after answer). */
  readonly revertMode: (mode: ChatMode) => void;
  /** Reset back to the conversation default (new thread). */
  readonly reset: () => void;
}

const DEFAULT_TEACHING: TeachingModeData = {
  conceptId: '',
  conceptName: '',
  conceptNameSw: null,
  bloomLevel: 'understand',
  keyPoints: [],
  keyPointsSw: [],
  conceptIndex: 0,
  totalConcepts: 1,
  isStreaming: false,
};

const DEFAULT_REVIEW: ReviewModeData = {
  masteryDelta: 0,
  conceptsCovered: 0,
  quizAccuracy: 0,
  bloomLevelReached: 'understand',
  misconceptionsAddressed: 0,
  recommendedNextConcepts: [],
  recommendedReviewDate: null,
  overallScore: 0,
};

/** First non-empty line of the reply — used as a human concept label. */
function firstLine(text: string): string {
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length > 0) return line.slice(0, 80);
  }
  return '';
}

/** First sentence / line as a discussion topic seed. */
function topicFrom(text: string): string {
  const line = firstLine(text);
  return line.length > 0 ? line : 'Discussion';
}

function buildTeaching(responseText: string): TeachingModeData {
  const extracted = extractTeachingData(responseText);
  const conceptName = firstLine(responseText);
  return {
    ...DEFAULT_TEACHING,
    ...extracted,
    conceptId: `c-${conceptName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32)}`,
    conceptName: conceptName || DEFAULT_TEACHING.conceptName,
  };
}

function buildReview(responseText: string): ReviewModeData {
  const extracted = extractReviewData(responseText);
  return { ...DEFAULT_REVIEW, ...extracted };
}

function buildDiscussion(responseText: string): DiscussionModeData {
  return {
    topic: topicFrom(responseText),
    topicSw: null,
    replies: [],
    handRaisedCount: 0,
  };
}

/**
 * Apply the detector result to the prior state, producing a new immutable
 * state. Only the data slice for the suggested mode is hydrated; the other
 * slices are cleared so a stale quiz/review card can never linger when the
 * mode moves on.
 */
function reduce(prev: ChatModeState, turn: AssistantTurn): ChatModeState {
  const detection = detectModeFromResponse({
    responseText: turn.responseText,
    toolCalls: turn.toolCalls,
    currentMode: prev.mode,
    isGroupSession: false,
    sessionMessageCount: turn.sessionMessageCount,
  });

  const mode = detection.suggestedMode;

  // Conversation (and classroom, which needs a live cohort we don't have
  // on this solo surface) render nothing extra — clear every data slice.
  if (mode === 'conversation' || mode === 'classroom') {
    return {
      ...INITIAL_CHAT_MODE_STATE,
      transitionHistory: prev.transitionHistory,
    };
  }

  const base: ChatModeState = {
    mode,
    teachingData: null,
    quizData: null,
    reviewData: null,
    classroomData: null,
    discussionData: null,
    transitionHistory: prev.transitionHistory,
    quizLockdown: false,
  };

  if (mode === 'teaching') {
    return { ...base, teachingData: buildTeaching(turn.responseText) };
  }
  if (mode === 'quiz') {
    const quiz = extractQuizData(turn.responseText);
    // No parsable A/B/C/D options → keep teaching context instead of an
    // empty lockdown the user could never answer out of.
    if (!quiz) {
      return { ...base, mode: 'teaching', teachingData: buildTeaching(turn.responseText) };
    }
    return {
      ...base,
      quizData: quiz as QuizLockdownData,
      quizLockdown: true,
    };
  }
  if (mode === 'review') {
    return { ...base, reviewData: buildReview(turn.responseText) };
  }
  // discussion
  return { ...base, discussionData: buildDiscussion(turn.responseText) };
}

export function useChatMode(): UseChatModeResult {
  const [state, setState] = useState<ChatModeState>(INITIAL_CHAT_MODE_STATE);

  const ingestAssistantTurn = useCallback((turn: AssistantTurn) => {
    setState((prev) => reduce(prev, turn));
  }, []);

  const revertMode = useCallback((mode: ChatMode) => {
    setState((prev) => {
      if (mode === 'conversation' || mode === 'classroom') {
        return { ...INITIAL_CHAT_MODE_STATE, transitionHistory: prev.transitionHistory };
      }
      return { ...prev, mode, quizLockdown: mode === 'quiz' ? prev.quizLockdown : false };
    });
  }, []);

  const reset = useCallback(() => {
    setState(INITIAL_CHAT_MODE_STATE);
  }, []);

  return useMemo(
    () => ({ state, ingestAssistantTurn, revertMode, reset }),
    [state, ingestAssistantTurn, revertMode, reset],
  );
}
