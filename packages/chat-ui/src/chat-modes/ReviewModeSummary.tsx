import type { ReviewModeData, Language, Translator } from './types';

interface ReviewModeSummaryProps {
  readonly data: ReviewModeData;
  readonly language: Language;
  readonly t?: Translator;
  readonly onRedo?: () => void;
  readonly onNext?: () => void;
}

const DEFAULT_LABELS: Record<string, string> = {
  'chatUi.review.title': 'Session summary',
  'chatUi.review.overallScore': 'Overall score',
  'chatUi.review.masteryDelta': 'Mastery change',
  'chatUi.review.conceptsCovered': 'Concepts covered',
  'chatUi.review.quizAccuracy': 'Quiz accuracy',
  'chatUi.review.bloomReached': 'Bloom level reached',
  'chatUi.review.misconceptions': 'Misconceptions addressed',
  'chatUi.review.recommendedReview': 'Next review',
  'chatUi.review.redo': 'Redo session',
  'chatUi.review.next': 'Next concept',
  'chatUi.review.nextConcepts': 'Recommended next concepts',
};

function tr(t: Translator | undefined, key: string): string {
  if (t) return t(key);
  return DEFAULT_LABELS[key] ?? key;
}

export function ReviewModeSummary({ data, language: _language, t, onRedo, onNext }: ReviewModeSummaryProps) {
  const deltaPercent = Math.round(data.masteryDelta * 100);
  const accuracy = Math.round(data.quizAccuracy * 100);
  const isPositive = deltaPercent >= 0;

  return (
    <div
      data-testid="review-mode-summary"
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 16,
        padding: 16,
        color: '#0f172a',
      }}
    >
      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{tr(t, 'chatUi.review.title')}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        <Stat label={tr(t, 'chatUi.review.overallScore')} value={`${data.overallScore}%`} />
        <Stat
          label={tr(t, 'chatUi.review.masteryDelta')}
          value={`${isPositive ? '+' : ''}${deltaPercent}%`}
          color={isPositive ? '#16a34a' : '#dc2626'}
        />
        <Stat label={tr(t, 'chatUi.review.conceptsCovered')} value={String(data.conceptsCovered)} />
        <Stat label={tr(t, 'chatUi.review.quizAccuracy')} value={`${accuracy}%`} />
        <Stat label={tr(t, 'chatUi.review.bloomReached')} value={data.bloomLevelReached} />
        <Stat label={tr(t, 'chatUi.review.misconceptions')} value={String(data.misconceptionsAddressed)} />
      </div>
      {data.recommendedNextConcepts.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>
            {tr(t, 'chatUi.review.nextConcepts')}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {data.recommendedNextConcepts.map((c) => (
              <span
                key={c}
                style={{
                  fontSize: 12,
                  padding: '4px 10px',
                  borderRadius: 999,
                  background: '#f1f5f9',
                  color: '#475569',
                }}
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}
      {data.recommendedReviewDate && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#64748b' }}>
          {tr(t, 'chatUi.review.recommendedReview')}: {data.recommendedReviewDate}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {onRedo && (
          <button
            type="button"
            onClick={onRedo}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              background: '#fff',
              color: '#0f172a',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {tr(t, 'chatUi.review.redo')}
          </button>
        )}
        {onNext && (
          <button
            type="button"
            onClick={onNext}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: 'none',
              background: '#3b82f6',
              color: '#fff',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {tr(t, 'chatUi.review.next')}
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { readonly label: string; readonly value: string; readonly color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#64748b' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color ?? '#0f172a' }}>{value}</div>
    </div>
  );
}
