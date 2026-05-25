import { describe, expect, it } from 'vitest';
import {
  detectModeFromResponse,
  extractQuizData,
  extractReviewData,
  extractTeachingData,
  shouldExtendQuizTime,
} from '../chat-modes/mode-detector';
import type { QuizLockdownData } from '../chat-modes/types';

describe('mode-detector — teaching', () => {
  it('switches to teaching on teach-concept tool call', () => {
    const result = detectModeFromResponse({
      responseText: '',
      toolCalls: ['teach-concept'],
      currentMode: 'conversation',
      isGroupSession: false,
      sessionMessageCount: 5,
    });
    expect(result.suggestedMode).toBe('teaching');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('switches to teaching on 2+ pedagogy keywords', () => {
    const result = detectModeFromResponse({
      responseText:
        "Let me explain rent affordability. The key points about rent-to-income ratios are simple.",
      toolCalls: [],
      currentMode: 'conversation',
      isGroupSession: false,
      sessionMessageCount: 5,
    });
    expect(result.suggestedMode).toBe('teaching');
  });
});

describe('mode-detector — quiz', () => {
  it('detects quiz pattern with A/B/C options', () => {
    const text = `Let me test your understanding. Which of the following is true?
A) Rent is always 50% of income
B) Rent should be at most 33% of gross income
C) Rent should equal the security deposit`;
    const result = detectModeFromResponse({
      responseText: text,
      toolCalls: [],
      currentMode: 'teaching',
      isGroupSession: false,
      sessionMessageCount: 5,
    });
    expect(result.suggestedMode).toBe('quiz');
  });

  it('extracts quiz options from response text', () => {
    const text = `Which is correct?
A) Option one
B) Option two
C) Option three`;
    const data = extractQuizData(text);
    expect(data).not.toBeNull();
    expect(data?.options?.length).toBe(3);
    expect(data?.options?.[0].id).toBe('A');
  });

  it('returns null when fewer than 2 options exist', () => {
    expect(extractQuizData('Just some text with no options.')).toBeNull();
  });
});

describe('mode-detector — classroom & discussion', () => {
  it('stays in classroom when group session is active', () => {
    const result = detectModeFromResponse({
      responseText: 'Normal chat.',
      toolCalls: [],
      currentMode: 'classroom',
      isGroupSession: true,
      sessionMessageCount: 10,
    });
    expect(result.suggestedMode).toBe('classroom');
  });

  it('switches to discussion in group sessions with 2+ discussion keywords', () => {
    const result = detectModeFromResponse({
      responseText: "Let's discuss. What do you think?",
      toolCalls: [],
      currentMode: 'teaching',
      isGroupSession: true,
      sessionMessageCount: 10,
    });
    expect(result.suggestedMode).toBe('discussion');
  });
});

describe('mode-detector — review', () => {
  it('switches to review on summary patterns', () => {
    const text = 'Session summary: your mastery increased by 15%. Your progress is strong.';
    const result = detectModeFromResponse({
      responseText: text,
      toolCalls: [],
      currentMode: 'teaching',
      isGroupSession: false,
      sessionMessageCount: 10,
    });
    expect(result.suggestedMode).toBe('review');
  });

  it('extracts review score and mastery delta', () => {
    const data = extractReviewData('You scored 85% and mastery increased by 12%.');
    expect(data.overallScore).toBe(85);
    expect(data.masteryDelta).toBeCloseTo(0.12);
  });
});

describe('mode-detector — warm-up', () => {
  it('never switches mode in the first 2 messages', () => {
    const result = detectModeFromResponse({
      responseText: 'Let me test your understanding. A) yes B) no',
      toolCalls: [],
      currentMode: 'conversation',
      isGroupSession: false,
      sessionMessageCount: 1,
    });
    expect(result.suggestedMode).toBe('conversation');
  });
});

describe('mode-detector — teaching extraction', () => {
  it('extracts bullet points as key points', () => {
    const data = extractTeachingData(`- Tenant's payment history matters\n- Property fit reduces turnover\n- Security deposit protects the landlord`);
    expect(data.keyPoints?.length).toBe(3);
  });

  it('defaults bloom level to understand when not specified', () => {
    const data = extractTeachingData('Generic teaching content');
    expect(data.bloomLevel).toBe('understand');
  });
});

describe('shouldExtendQuizTime', () => {
  const base: QuizLockdownData = {
    questionId: 'q',
    question: 'q',
    questionSw: null,
    options: [],
    timeLimitSeconds: 30,
    timeRemainingSeconds: 30,
    difficulty: 'basic',
    bloomLevel: 'understand',
    pointsValue: 10,
    answeredCount: 0,
    totalParticipants: 10,
    timeExtended: false,
  };

  it('extends when few answered and little time left', () => {
    expect(shouldExtendQuizTime({ ...base, answeredCount: 2, timeRemainingSeconds: 5 })).toBe(true);
  });

  it('does not extend when already extended', () => {
    expect(shouldExtendQuizTime({ ...base, answeredCount: 2, timeRemainingSeconds: 5, timeExtended: true })).toBe(false);
  });

  it('does not extend in solo sessions', () => {
    expect(shouldExtendQuizTime({ ...base, totalParticipants: 1, answeredCount: 0, timeRemainingSeconds: 1 })).toBe(false);
  });
});
