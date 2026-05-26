/**
 * BorjieModeSelector — eight-mode CEO dropdown for FloatingAskBorjie.
 *
 * Persists the choice to localStorage under `borjie.chat.mode`.
 * Bilingual sw/en labels; the active mode is announced via aria-live
 * so screen-reader users learn which lens the answer was framed by.
 */
import { useCallback, type ChangeEvent } from 'react';
import type { BorjieLanguage, BorjieMode } from './useBorjieChat';

interface ModeLabel {
  readonly en: string;
  readonly sw: string;
}

const MODE_ORDER: readonly BorjieMode[] = [
  'build',
  'strategy',
  'operations',
  'document',
  'finance',
  'risk',
  'board-investor',
  'compliance',
];

const MODE_LABELS: Readonly<Record<BorjieMode, ModeLabel>> = {
  build: { en: 'Build', sw: 'Jenga' },
  strategy: { en: 'Strategy', sw: 'Mkakati' },
  operations: { en: 'Operations', sw: 'Shughuli' },
  document: { en: 'Document', sw: 'Hati' },
  finance: { en: 'Finance', sw: 'Fedha' },
  risk: { en: 'Risk', sw: 'Hatari' },
  'board-investor': { en: 'Board / Investor', sw: 'Bodi / Mwekezaji' },
  compliance: { en: 'Compliance', sw: 'Kanuni' },
};

interface BorjieModeSelectorProps {
  readonly value: BorjieMode;
  readonly language: BorjieLanguage;
  readonly onChange: (next: BorjieMode) => void;
  readonly disabled?: boolean;
}

export function modeLabel(mode: BorjieMode, language: BorjieLanguage): string {
  return MODE_LABELS[mode][language];
}

export function BorjieModeSelector({
  value,
  language,
  onChange,
  disabled,
}: BorjieModeSelectorProps): JSX.Element {
  const onSelect = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const next = e.target.value as BorjieMode;
      if (MODE_ORDER.includes(next)) {
        onChange(next);
      }
    },
    [onChange],
  );

  const ariaLabel = language === 'sw' ? 'Chagua hali ya Borjie' : 'Choose Borjie mode';

  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11,
        color: '#475569',
      }}
    >
      <span style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
        {language === 'sw' ? 'Hali' : 'Mode'}
      </span>
      <select
        data-testid="borjie-mode-selector"
        aria-label={ariaLabel}
        value={value}
        onChange={onSelect}
        disabled={disabled}
        style={{
          background: '#fff',
          border: '1px solid #cbd5e1',
          borderRadius: 8,
          padding: '4px 8px',
          fontSize: 12,
          color: '#0f172a',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {MODE_ORDER.map((m) => (
          <option key={m} value={m}>
            {MODE_LABELS[m][language]}
          </option>
        ))}
      </select>
    </label>
  );
}

export { MODE_ORDER as BORJIE_MODES, MODE_LABELS as BORJIE_MODE_LABELS };
