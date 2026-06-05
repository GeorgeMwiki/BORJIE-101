'use client';

/**
 * ChatModeSurface — renders the active pedagogical chat-mode layout from
 * `@borjie/chat-ui` beneath the HomeChatTeach transcript.
 *
 * Pure presentational switch over `ChatModeState.mode`:
 *  - teaching   → <TeachingModeLayout>   (concept + key points + Bloom badge)
 *  - quiz       → <QuizLockdownOverlay>   (timed A/B/C/D lockdown)
 *  - review     → <ReviewModeSummary>     (mastery / score recap)
 *  - discussion → <DiscussionModeLayout>  (open-floor topic)
 *  - conversation / classroom → null      (default surface unchanged)
 *
 * Mode detection lives in `useChatMode`; this component only renders. All
 * user-facing copy resolves through `makeChatModeTranslator(locale)` so the
 * render is single-language per active locale (no EN/SW mixing) and carries
 * zero Swahili literals in component source.
 */

import { useCallback, useMemo } from 'react';
import type { ReactElement } from 'react';
import {
  TeachingModeLayout,
  QuizLockdownOverlay,
  ReviewModeSummary,
  DiscussionModeLayout,
  type ChatMode,
  type ChatModeState,
  type Language,
} from '@borjie/chat-ui';
import { makeChatModeTranslator } from '@/i18n/strings/chat-modes';

export interface ChatModeSurfaceProps {
  readonly state: ChatModeState;
  readonly language: Language;
  /**
   * Revert to a target mode — wired to the quiz overlay's auto-revert
   * (answer/time-up returns to teaching) so a lockdown never traps the user.
   */
  readonly onModeRevert: (mode: ChatMode) => void;
  /**
   * Post a follow-up owner message (mirrors HomeChatTeach's `onSuggestion`),
   * letting in-layout actions drive the next brain turn instead of dead-ending:
   * a chosen quiz option, a "next concept" request, etc.
   */
  readonly onFollowUp: (text: string) => void;
  /** Disable interactive controls while a turn is streaming. */
  readonly disabled: boolean;
}

export function ChatModeSurface({
  state,
  language,
  onModeRevert,
  onFollowUp,
  disabled,
}: ChatModeSurfaceProps): ReactElement | null {
  const t = useMemo(() => makeChatModeTranslator(language), [language]);

  const isSw = language === 'sw';

  const onQuizAnswer = useCallback(
    (optionId: string) => {
      if (disabled) return;
      const verb = isSw ? 'Jibu langu ni' : 'My answer is';
      onFollowUp(`${verb} ${optionId}`);
    },
    [disabled, isSw, onFollowUp],
  );

  const onQuizTimeUp = useCallback(() => {
    onModeRevert('teaching');
  }, [onModeRevert]);

  const onReviewNext = useCallback(() => {
    if (disabled) return;
    onFollowUp(isSw ? 'Tuendelee na dhana inayofuata.' : "Let's move to the next concept.");
  }, [disabled, isSw, onFollowUp]);

  const onReviewRedo = useCallback(() => {
    if (disabled) return;
    onFollowUp(isSw ? 'Naomba turudie kipindi hiki.' : "Let's redo this session.");
  }, [disabled, isSw, onFollowUp]);

  const onRaiseHand = useCallback(() => {
    if (disabled) return;
    onFollowUp(isSw ? 'Nina swali.' : 'I have a question.');
  }, [disabled, isSw, onFollowUp]);

  if (state.mode === 'teaching' && state.teachingData) {
    return (
      <div data-testid="chat-mode-surface" data-mode="teaching" className="mt-3 overflow-hidden rounded-2xl">
        <TeachingModeLayout data={state.teachingData} language={language} t={t} />
      </div>
    );
  }

  if (state.mode === 'quiz' && state.quizData) {
    return (
      <div data-testid="chat-mode-surface" data-mode="quiz" className="mt-3 overflow-hidden rounded-2xl">
        <QuizLockdownOverlay
          data={state.quizData}
          language={language}
          onAnswer={onQuizAnswer}
          onTimeUp={onQuizTimeUp}
          onModeRevert={onModeRevert}
          t={t}
        />
      </div>
    );
  }

  if (state.mode === 'review' && state.reviewData) {
    return (
      <div data-testid="chat-mode-surface" data-mode="review" className="mt-3">
        <ReviewModeSummary
          data={state.reviewData}
          language={language}
          t={t}
          onRedo={onReviewRedo}
          onNext={onReviewNext}
        />
      </div>
    );
  }

  if (state.mode === 'discussion' && state.discussionData) {
    return (
      <div data-testid="chat-mode-surface" data-mode="discussion" className="mt-3">
        <DiscussionModeLayout
          data={state.discussionData}
          language={language}
          t={t}
          onRaiseHand={onRaiseHand}
        />
      </div>
    );
  }

  // conversation / classroom (or a mode whose data slice is empty): the
  // default teaching surface renders unchanged.
  return null;
}
