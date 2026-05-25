import { useMemo, useState } from 'react';
import type { RentAffordabilityCalculatorBlock } from '../types';
import type { Language, Translator } from '../../chat-modes/types';

interface Props {
  readonly block: RentAffordabilityCalculatorBlock;
  readonly language: Language;
  readonly t?: Translator;
}

const DEFAULT_LABELS: Record<string, string> = {
  'chatUi.block.rent.title': 'Rent affordability',
  'chatUi.block.rent.rent': 'Monthly rent',
  'chatUi.block.rent.income': 'Gross monthly income',
  'chatUi.block.rent.ratio': 'Rent-to-income ratio',
  'chatUi.block.rent.statusAffordable': 'Comfortably affordable',
  'chatUi.block.rent.statusTight': 'Tight — budget carefully',
  'chatUi.block.rent.statusUnaffordable': 'Unaffordable — reject or coach',
};

function tr(t: Translator | undefined, key: string): string {
  if (t) return t(key);
  return DEFAULT_LABELS[key] ?? key;
}

/** Classification thresholds (exported for tests). */
export function classifyAffordability(rent: number, grossIncome: number): {
  readonly ratio: number;
  readonly status: 'green' | 'yellow' | 'red';
} {
  if (grossIncome <= 0) return { ratio: 0, status: 'red' };
  const ratio = rent / grossIncome;
  if (ratio <= 0.33) return { ratio, status: 'green' };
  if (ratio <= 0.4) return { ratio, status: 'yellow' };
  return { ratio, status: 'red' };
}

const STATUS_COLOR: Record<'green' | 'yellow' | 'red', string> = {
  green: '#16a34a',
  yellow: '#d97706',
  red: '#dc2626',
};

export function RentAffordabilityCalculator({ block, language: _language, t }: Props) {
  const [rent, setRent] = useState(block.defaultRent);
  const [income, setIncome] = useState(block.defaultIncome);

  const { ratio, status } = useMemo(() => classifyAffordability(rent, income), [rent, income]);
  const percent = Math.round(ratio * 1000) / 10;

  const statusLabel =
    status === 'green'
      ? tr(t, 'chatUi.block.rent.statusAffordable')
      : status === 'yellow'
        ? tr(t, 'chatUi.block.rent.statusTight')
        : tr(t, 'chatUi.block.rent.statusUnaffordable');

  return (
    <div
      data-testid="rent-affordability-calculator"
      data-status={status}
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        padding: 16,
      }}
    >
      <h4 style={{ margin: 0, marginBottom: 12, fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
        {block.title ?? tr(t, 'chatUi.block.rent.title')}
      </h4>

      <Field
        label={tr(t, 'chatUi.block.rent.rent')}
        value={rent}
        onChange={setRent}
        suffix={block.currency}
        testId="rent-input"
      />
      <Field
        label={tr(t, 'chatUi.block.rent.income')}
        value={income}
        onChange={setIncome}
        suffix={block.currency}
        testId="income-input"
      />

      <div
        style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 8,
          background: `${STATUS_COLOR[status]}15`,
          border: `1px solid ${STATUS_COLOR[status]}40`,
        }}
      >
        <div style={{ fontSize: 12, color: '#64748b' }}>{tr(t, 'chatUi.block.rent.ratio')}</div>
        <div
          data-testid="rent-ratio"
          style={{ fontSize: 24, fontWeight: 700, color: STATUS_COLOR[status] }}
        >
          {percent}%
        </div>
        <div data-testid="rent-status" style={{ fontSize: 13, color: STATUS_COLOR[status], fontWeight: 500 }}>
          {statusLabel}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  suffix,
  testId,
}: {
  readonly label: string;
  readonly value: number;
  readonly onChange: (n: number) => void;
  readonly suffix?: string;
  readonly testId?: string;
}) {
  return (
    <label style={{ display: 'block', marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: '#475569', display: 'block', marginBottom: 4 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="number"
          data-testid={testId}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          style={{
            flex: 1,
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid #cbd5e1',
            fontSize: 14,
          }}
        />
        {suffix && <span style={{ fontSize: 12, color: '#64748b' }}>{suffix}</span>}
      </div>
    </label>
  );
}
