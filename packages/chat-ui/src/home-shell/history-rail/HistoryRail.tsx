/**
 * HistoryRail — optional left collapsible chat history rail.
 *
 * Only renders when HomeShell is in `split_with_history` variant.
 * Supplies are simple — host app fetches conversations elsewhere
 * and hands them in. The rail itself is purely presentational.
 *
 * Spec: HOME_DASHBOARD_STANDARD §2.
 */

import { useCallback, useState, type CSSProperties } from 'react';
import { HistoryItem } from './HistoryItem.js';

export interface HistoryRailConversation {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string | undefined;
}

export interface HistoryRailProps {
  readonly conversations: ReadonlyArray<HistoryRailConversation>;
  readonly active_id: string;
  readonly onSelect: (id: string) => void;
  readonly collapsed_initial?: boolean | undefined;
  readonly testId?: string | undefined;
}

const RAIL_STYLE_EXPANDED: CSSProperties = {
  width: 260,
  borderRight: '1px solid var(--color-border, #e5e7eb)',
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  background: 'var(--color-card-soft, #fafafa)',
  overflowY: 'auto',
};

const RAIL_STYLE_COLLAPSED: CSSProperties = {
  width: 48,
  borderRight: '1px solid var(--color-border, #e5e7eb)',
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  background: 'var(--color-card-soft, #fafafa)',
};

const TOGGLE_STYLE: CSSProperties = {
  alignSelf: 'flex-start',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 12,
  color: 'var(--color-muted-foreground, #64748b)',
  padding: '4px 6px',
  borderRadius: 6,
};

export function HistoryRail(props: HistoryRailProps): JSX.Element {
  const {
    conversations,
    active_id,
    onSelect,
    collapsed_initial = false,
    testId = 'home-history-rail',
  } = props;
  const [collapsed, setCollapsed] = useState<boolean>(collapsed_initial);

  const toggle = useCallback(() => setCollapsed((v) => !v), []);

  return (
    <aside
      data-testid={testId}
      style={collapsed ? RAIL_STYLE_COLLAPSED : RAIL_STYLE_EXPANDED}
    >
      <button
        type="button"
        data-testid="home-history-rail-toggle"
        onClick={toggle}
        style={TOGGLE_STYLE}
        aria-expanded={!collapsed}
      >
        {collapsed ? '>' : '<'}
      </button>
      {collapsed
        ? null
        : conversations.map((c) => (
            <HistoryItem
              key={c.id}
              id={c.id}
              title={c.title}
              subtitle={c.subtitle}
              active={c.id === active_id}
              onSelect={onSelect}
            />
          ))}
    </aside>
  );
}
