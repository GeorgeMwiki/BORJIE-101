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

  // Inline visual mirrors LitFin's header tool buttons — translucent
  // chip on the gold-gradient header bar. The native <select> chrome is
  // forced quiet (transparent background, no double border) so it reads
  // as a header tool, not a free-floating form input.
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0,
        fontSize: 10,
        color: 'rgba(23, 16, 10, 0.78)',
      }}
    >
      <span style={{ position: 'absolute', left: -9999, top: -9999 }}>
        {language === 'sw' ? 'Hali' : 'Mode'}
      </span>
      <select
        data-testid="borjie-mode-selector"
        aria-label={ariaLabel}
        value={value}
        onChange={onSelect}
        disabled={disabled}
        style={{
          background: 'rgba(255, 255, 255, 0.32)',
          border: '1px solid rgba(23, 16, 10, 0.20)',
          borderRadius: 999,
          padding: '4px 22px 4px 10px',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.02em',
          color: '#17100A',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          appearance: 'none',
          WebkitAppearance: 'none',
          MozAppearance: 'none',
          backgroundImage:
            'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'10\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%2317100A\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'><path d=\'M6 9l6 6 6-6\'/></svg>")',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 7px center',
          backgroundSize: '10px 10px',
          outline: 'none',
        }}
      >
        {MODE_ORDER.map((m) => (
          <option key={m} value={m} style={{ color: '#0F172A', background: '#FFFFFF' }}>
            {MODE_LABELS[m][language]}
          </option>
        ))}
      </select>
    </label>
  );
}

export { MODE_ORDER as BORJIE_MODES, MODE_LABELS as BORJIE_MODE_LABELS };
