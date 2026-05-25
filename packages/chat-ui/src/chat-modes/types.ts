/**
 * Chat Mode System Types (BORJIE estate-management training)
 *
 * Ported from LitFin's pedagogical chat modes. The chat transforms its
 * layout based on AI context, so no page navigation is needed during a
 * training session for estate managers, coworkers, owners, or tenants.
 *
 * Modes:
 *  - conversation  : default chat
 *  - teaching      : concept explanation with key points, Bloom's-level badge
 *  - quiz          : lockdown overlay for quick assessment
 *  - discussion    : threaded replies / open floor
 *  - review        : mastery summary after a learning block
 *  - classroom     : cohort session with roster
 */

export type ChatMode =
  | 'conversation'
  | 'teaching'
  | 'quiz'
  | 'discussion'
  | 'review'
  | 'classroom';

export type BloomLevel =
  | 'remember'
  | 'understand'
  | 'apply'
  | 'analyze'
  | 'evaluate'
  | 'create';

export interface ChatModeTransition {
  readonly from: ChatMode;
  readonly to: ChatMode;
  readonly reason: string;
  readonly triggeredBy: 'ai' | 'moderator' | 'system' | 'user';
  readonly timestamp: string;
}

export interface TeachingModeData {
  readonly conceptId: string;
  readonly conceptName: string;
  readonly conceptNameSw: string | null;
  readonly bloomLevel: BloomLevel;
  readonly keyPoints: readonly string[];
  readonly keyPointsSw: readonly string[];
  readonly conceptIndex: number;
  readonly totalConcepts: number;
  readonly isStreaming: boolean;
}

export interface QuizOption {
  readonly id: string;
  readonly label: string;
  readonly labelSw: string | null;
}

export interface QuizLockdownData {
  readonly questionId: string;
  readonly question: string;
  readonly questionSw: string | null;
  readonly options: readonly QuizOption[];
  readonly timeLimitSeconds: number;
  readonly timeRemainingSeconds: number;
  readonly difficulty: 'basic' | 'medium' | 'pro';
  readonly bloomLevel: BloomLevel;
  readonly pointsValue: number;
  readonly answeredCount: number;
  readonly totalParticipants: number;
  readonly timeExtended: boolean;
}

export interface ReviewModeData {
  readonly masteryDelta: number;
  readonly conceptsCovered: number;
  readonly quizAccuracy: number;
  readonly bloomLevelReached: BloomLevel;
  readonly misconceptionsAddressed: number;
  readonly recommendedNextConcepts: readonly string[];
  readonly recommendedReviewDate: string | null;
  readonly overallScore: number;
}

export interface ClassroomParticipant {
  readonly userId: string;
  readonly displayName: string;
  readonly isPresent: boolean;
  readonly isModerator: boolean;
  readonly engagementLevel: 'active' | 'passive' | 'disengaged' | 'struggling';
  readonly score: number;
}

export interface ClassroomModeData {
  readonly sessionId: string;
  readonly sessionCode: string;
  readonly participants: readonly ClassroomParticipant[];
  readonly currentPhase: string;
  readonly isRecording: boolean;
  readonly moderatorIsObserver: boolean;
  readonly maxParticipants: number;
}

export interface DiscussionReply {
  readonly id: string;
  readonly author: string;
  readonly text: string;
  readonly reactions: readonly string[];
  readonly timestamp: string;
}

export interface DiscussionModeData {
  readonly topic: string;
  readonly topicSw: string | null;
  readonly replies: readonly DiscussionReply[];
  readonly handRaisedCount: number;
}

export interface ChatModeState {
  readonly mode: ChatMode;
  readonly teachingData: TeachingModeData | null;
  readonly quizData: QuizLockdownData | null;
  readonly reviewData: ReviewModeData | null;
  readonly classroomData: ClassroomModeData | null;
  readonly discussionData: DiscussionModeData | null;
  readonly transitionHistory: readonly ChatModeTransition[];
  readonly quizLockdown: boolean;
}

export const INITIAL_CHAT_MODE_STATE: ChatModeState = {
  mode: 'conversation',
  teachingData: null,
  quizData: null,
  reviewData: null,
  classroomData: null,
  discussionData: null,
  transitionHistory: [],
  quizLockdown: false,
};

/** i18n translator shape: apps pass next-intl's or react-intl's t() here. */
export type Translator = (key: string, vars?: Record<string, string | number>) => string;

export type Language = 'en' | 'sw';
