/**
 * HistoryItem — single conversation entry in the HistoryRail.
 */

import type { CSSProperties } from 'react';

export interface HistoryItemProps {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly active: boolean;
  readonly onSelect: (id: string) => void;
}

function itemStyle(active: boolean): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '8px 12px',
    borderRadius: 8,
    cursor: 'pointer',
    background: active ? 'var(--color-primary-soft, #f1f5f9)' : 'transparent',
    border: '1px solid transparent',
    fontFamily: 'inherit',
    fontSize: 13,
    color: 'var(--color-foreground, #0f172a)',
    textAlign: 'left',
    width: '100%',
  };
}

const SUBTITLE_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--color-muted-foreground, #64748b)',
};

export function HistoryItem(props: HistoryItemProps): JSX.Element {
  const { id, title, subtitle, active, onSelect } = props;
  return (
    <button
      type="button"
      data-testid={`home-history-item-${id}`}
      onClick={() => onSelect(id)}
      style={itemStyle(active)}
      aria-current={active ? 'true' : undefined}
    >
      <span>{title}</span>
      {subtitle ? <span style={SUBTITLE_STYLE}>{subtitle}</span> : null}
    </button>
  );
}
