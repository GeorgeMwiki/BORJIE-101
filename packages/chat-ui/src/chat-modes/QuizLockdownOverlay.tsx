import { useState, useEffect, useCallback } from 'react';
import type { QuizLockdownData, QuizOption, Language, Translator, ChatMode } from './types';

interface QuizLockdownOverlayProps {
  readonly data: QuizLockdownData;
  readonly language: Language;
  readonly onAnswer: (optionId: string) => void;
  readonly onTimeUp: () => void;
  readonly onModeRevert: (mode: ChatMode) => void;
  readonly t?: Translator;
}

function getTimerColor(remaining: number, total: number): string {
  const ratio = remaining / total;
  if (ratio > 0.5) return '#4ade80';
  if (ratio > 0.25) return '#facc15';
  return '#f87171';
}

const DEFAULT_LABELS: Record<string, string> = {
  'chatUi.quiz.lockdown': 'Quiz locked: answer to continue',
  'chatUi.quiz.answerSubmitted': 'Answer submitted',
  'chatUi.quiz.points': 'pts',
  'chatUi.quiz.timeExtended': 'Time extended',
  'chatUi.quiz.option': 'Option',
  'chatUi.quiz.difficultyBasic': 'Basic',
  'chatUi.quiz.difficultyMedium': 'Medium',
  'chatUi.quiz.difficultyPro': 'Pro',
};

function tr(t: Translator | undefined, key: string): string {
  if (t) return t(key);
  return DEFAULT_LABELS[key] ?? key;
}

export function QuizLockdownOverlay({
  data,
  language,
  onAnswer,
  onTimeUp,
  onModeRevert,
  t,
}: QuizLockdownOverlayProps) {
  const [timeRemaining, setTimeRemaining] = useState(data.timeRemainingSeconds);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);

  useEffect(() => {
    if (isAnswered || timeRemaining <= 0) return undefined;
    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          onTimeUp();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isAnswered, timeRemaining, onTimeUp]);

  const handleSelect = useCallback(
    (optionId: string) => {
      if (isAnswered) return;
      setSelectedOption(optionId);
      setIsAnswered(true);
      onAnswer(optionId);
      setTimeout(() => onModeRevert('teaching'), 1500);
    },
    [isAnswered, onAnswer, onModeRevert],
  );

  const timerColor = getTimerColor(timeRemaining, data.timeLimitSeconds);
  const progress = Math.max(0, Math.min(100, (timeRemaining / data.timeLimitSeconds) * 100));

  return (
    <div
      data-testid="quiz-lockdown-overlay"
      style={{
        background: 'rgba(15,23,42,0.95)',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        padding: 16,
        color: '#fff',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ color: '#fbbf24', fontSize: 14, fontWeight: 500 }}>{tr(t, 'chatUi.quiz.lockdown')}</span>
        <span data-testid="quiz-timer" style={{ color: timerColor, fontFamily: 'monospace', fontWeight: 700 }}>
          {timeRemaining}s
        </span>
      </div>
      <div style={{ height: 6, background: '#334155', borderRadius: 999, overflow: 'hidden', marginBottom: 12 }}>
        <div
          data-testid="quiz-timer-progress"
          style={{ height: '100%', width: `${progress}%`, background: timerColor, transition: 'width 1s linear' }}
        />
      </div>

      {data.question && (
        <p style={{ fontSize: 16, fontWeight: 500, marginBottom: 12 }}>
          {language === 'sw' && data.questionSw ? data.questionSw : data.question}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.options.map((option) => (
          <OptionButton
            key={option.id}
            option={option}
            language={language}
            selected={selectedOption === option.id}
            answered={isAnswered}
            onSelect={handleSelect}
            optionLabel={tr(t, 'chatUi.quiz.option')}
          />
        ))}
      </div>

      {isAnswered && (
        <div data-testid="quiz-answered" style={{ marginTop: 12, color: '#4ade80', fontSize: 14 }}>
          ✓ {tr(t, 'chatUi.quiz.answerSubmitted')}
        </div>
      )}
    </div>
  );
}

function OptionButton({
  option,
  language,
  selected,
  answered,
  onSelect,
  optionLabel,
}: {
  readonly option: QuizOption;
  readonly language: Language;
  readonly selected: boolean;
  readonly answered: boolean;
  readonly onSelect: (id: string) => void;
  readonly optionLabel: string;
}) {
  const label = language === 'sw' && option.labelSw ? option.labelSw : option.label;
  return (
    <button
      type="button"
      data-testid={`quiz-option-${option.id}`}
      onClick={() => onSelect(option.id)}
      disabled={answered}
      aria-label={`${optionLabel} ${option.id}: ${label}`}
      style={{
        width: '100%',
        padding: '12px 16px',
        borderRadius: 12,
        textAlign: 'left',
        fontSize: 14,
        fontWeight: 500,
        border: selected ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.1)',
        background: selected ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
        color: '#fff',
        cursor: answered ? 'not-allowed' : 'pointer',
      }}
    >
      <strong style={{ marginRight: 12, color: selected ? '#60a5fa' : 'rgba(255,255,255,0.6)' }}>{option.id}</strong>
      {label}
    </button>
  );
}
