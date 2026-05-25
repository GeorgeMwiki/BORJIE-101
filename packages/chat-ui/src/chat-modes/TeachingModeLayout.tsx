import { useMemo } from 'react';
import type { TeachingModeData, Language, Translator, BloomLevel } from './types';

interface TeachingModeLayoutProps {
  readonly data: TeachingModeData;
  readonly language: Language;
  readonly participantCount?: number;
  readonly t?: Translator;
}

const BLOOM_COLOR: Record<BloomLevel, string> = {
  remember: '#60a5fa',
  understand: '#34d399',
  apply: '#fbbf24',
  analyze: '#fb923c',
  evaluate: '#f87171',
  create: '#c084fc',
};

const BLOOM_LEVEL_INDEX: Record<BloomLevel, number> = {
  remember: 1,
  understand: 2,
  apply: 3,
  analyze: 4,
  evaluate: 5,
  create: 6,
};

const DEFAULT_LABELS: Record<string, string> = {
  'chatUi.teaching.keyPoints': 'Key points',
  'chatUi.teaching.bloomRemember': 'Remember',
  'chatUi.teaching.bloomUnderstand': 'Understand',
  'chatUi.teaching.bloomApply': 'Apply',
  'chatUi.teaching.bloomAnalyze': 'Analyze',
  'chatUi.teaching.bloomEvaluate': 'Evaluate',
  'chatUi.teaching.bloomCreate': 'Create',
  'chatUi.teaching.conceptProgress': 'Concept {current} of {total}',
  'chatUi.teaching.participantsLearning': '{count} learners active',
};

function tr(t: Translator | undefined, key: string, vars?: Record<string, string | number>): string {
  if (t) return t(key, vars);
  let value = DEFAULT_LABELS[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      value = value.replace(`{${k}}`, String(v));
    }
  }
  return value;
}

function bloomLabelKey(level: BloomLevel): string {
  return `chatUi.teaching.bloom${level.charAt(0).toUpperCase() + level.slice(1)}`;
}

export function TeachingModeLayout({
  data,
  language,
  participantCount,
  t,
}: TeachingModeLayoutProps) {
  const conceptName = useMemo(() => {
    if (language === 'sw' && data.conceptNameSw) return data.conceptNameSw;
    return data.conceptName;
  }, [language, data.conceptName, data.conceptNameSw]);

  const keyPoints = useMemo(() => {
    if (language === 'sw' && data.keyPointsSw.length > 0) return data.keyPointsSw;
    return data.keyPoints;
  }, [language, data.keyPoints, data.keyPointsSw]);

  const progressPercent =
    data.totalConcepts > 0
      ? Math.round(((data.conceptIndex + 1) / data.totalConcepts) * 100)
      : 0;

  const bloomColor = BLOOM_COLOR[data.bloomLevel] ?? BLOOM_COLOR.understand;
  const bloomIndex = BLOOM_LEVEL_INDEX[data.bloomLevel] ?? 2;
  const bloomLabel = tr(t, bloomLabelKey(data.bloomLevel));

  return (
    <div
      data-testid="teaching-mode-layout"
      className="bn-chat-teaching-layout"
      style={{
        background: 'rgba(15, 23, 42, 0.92)',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        color: '#fff',
        padding: '12px 16px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span aria-hidden="true" style={{ color: '#60a5fa' }}>◆</span>
          <span style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {conceptName}
          </span>
          {data.isStreaming && <span data-testid="teaching-streaming-dots">…</span>}
        </div>
        <div
          data-testid="teaching-bloom-badge"
          style={{
            background: `${bloomColor}33`,
            color: bloomColor,
            padding: '2px 10px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {bloomLabel} · L{bloomIndex}
        </div>
      </div>

      {data.totalConcepts > 1 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, opacity: 0.5 }}>
            {tr(t, 'chatUi.teaching.conceptProgress', {
              current: data.conceptIndex + 1,
              total: data.totalConcepts,
            })}{' '}
            — {progressPercent}%
          </div>
          <div style={{ height: 4, background: '#334155', borderRadius: 999, overflow: 'hidden' }}>
            <div
              data-testid="teaching-progress-bar"
              style={{
                height: '100%',
                width: `${progressPercent}%`,
                background: '#3b82f6',
                transition: 'width 500ms',
              }}
            />
          </div>
        </div>
      )}

      {keyPoints.length > 0 && (
        <div
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12,
            padding: 12,
          }}
        >
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 6, fontWeight: 500 }}>
            {tr(t, 'chatUi.teaching.keyPoints')}
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {keyPoints.map((point, idx) => (
              <li key={idx} style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', marginBottom: 4 }}>
                <span style={{ color: '#60a5fa' }}>›</span> {point}
              </li>
            ))}
          </ul>
        </div>
      )}

      {participantCount !== undefined && participantCount > 1 && (
        <div style={{ marginTop: 8, fontSize: 10, opacity: 0.5 }}>
          {tr(t, 'chatUi.teaching.participantsLearning', { count: participantCount })}
        </div>
      )}
    </div>
  );
}
