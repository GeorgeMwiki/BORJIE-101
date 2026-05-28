/**
 * SlashMenu + AtMenu — renderer-pure menus the chat composer mounts
 * inside a popover above the input. Keyboard navigation lives in the
 * host composer (ArrowUp/ArrowDown/Enter/Escape); these components are
 * pure projections of the filtered catalog.
 *
 * Each menu emits `onSelect(item)` when the user clicks (or the host
 * forwards a keyboard activation). Hosts are responsible for calling
 * `applySelection` from the trigger-parser to update the textarea.
 *
 * Design discipline:
 *   - <40 lines per render fn (CLAUDE.md house rule).
 *   - No internal state; the host owns highlight + filter inputs.
 *   - Bilingual labels resolved via the `locale` prop.
 *   - `data-testid` hooks for vitest.
 */

import type { CSSProperties } from 'react';
import type { SlashCommand, EntityReference } from './trigger-parser';

export interface MenuItemLabel {
  readonly en: string;
  readonly sw: string;
}

export interface SlashMenuProps {
  readonly commands: ReadonlyArray<SlashCommand>;
  readonly locale: 'en' | 'sw';
  readonly activeIndex: number;
  readonly onSelect: (cmd: SlashCommand) => void;
  readonly testId?: string;
}

export interface AtMenuProps {
  readonly entities: ReadonlyArray<EntityReference>;
  readonly locale: 'en' | 'sw';
  readonly activeIndex: number;
  readonly onSelect: (entity: EntityReference) => void;
  readonly testId?: string;
}

const MENU_STYLE: CSSProperties = {
  position: 'absolute',
  bottom: 'calc(100% + 8px)',
  left: 0,
  right: 0,
  maxHeight: 280,
  overflowY: 'auto',
  background: 'var(--color-background, #ffffff)',
  border: '1px solid var(--color-border, #e5e7eb)',
  borderRadius: 12,
  boxShadow: '0 8px 32px rgba(15, 23, 42, 0.12)',
  zIndex: 50,
};

const ROW_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: '10px 14px',
  cursor: 'pointer',
  fontSize: 14,
  borderBottom: '1px solid var(--color-border-subtle, #f1f5f9)',
};

const ROW_ACTIVE_STYLE: CSSProperties = {
  ...ROW_STYLE,
  background: 'var(--color-accent-subtle, #FAF6EE)',
};

const HINT_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--color-foreground-muted, #64748b)',
  marginTop: 2,
};

const EMPTY_STYLE: CSSProperties = {
  padding: '14px',
  fontSize: 13,
  color: 'var(--color-foreground-muted, #64748b)',
  textAlign: 'center',
};

function emptyText(locale: 'en' | 'sw', kind: 'commands' | 'entities'): string {
  if (locale === 'sw') {
    return kind === 'commands'
      ? 'Hakuna amri inayolingana.'
      : 'Hakuna kitu kinacholingana.';
  }
  return kind === 'commands'
    ? 'No matching commands.'
    : 'No matching entities.';
}

export function SlashMenu(props: SlashMenuProps): JSX.Element {
  const { commands, locale, activeIndex, onSelect, testId = 'slash-menu' } = props;
  if (commands.length === 0) {
    return (
      <div data-testid={testId} style={MENU_STYLE} role="listbox">
        <div style={EMPTY_STYLE}>{emptyText(locale, 'commands')}</div>
      </div>
    );
  }
  return (
    <div data-testid={testId} style={MENU_STYLE} role="listbox">
      {commands.map((cmd, index) => {
        const active = index === activeIndex;
        return (
          <div
            key={cmd.id}
            data-testid={`slash-menu-item-${cmd.id}`}
            role="option"
            aria-selected={active}
            style={active ? ROW_ACTIVE_STYLE : ROW_STYLE}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(cmd);
            }}
          >
            <span style={{ fontWeight: 600 }}>{cmd.label[locale]}</span>
            {cmd.hint ? <span style={HINT_STYLE}>{cmd.hint[locale]}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

export function AtMenu(props: AtMenuProps): JSX.Element {
  const { entities, locale, activeIndex, onSelect, testId = 'at-menu' } = props;
  if (entities.length === 0) {
    return (
      <div data-testid={testId} style={MENU_STYLE} role="listbox">
        <div style={EMPTY_STYLE}>{emptyText(locale, 'entities')}</div>
      </div>
    );
  }
  return (
    <div data-testid={testId} style={MENU_STYLE} role="listbox">
      {entities.map((entity, index) => {
        const active = index === activeIndex;
        return (
          <div
            key={entity.id}
            data-testid={`at-menu-item-${entity.id}`}
            role="option"
            aria-selected={active}
            style={active ? ROW_ACTIVE_STYLE : ROW_STYLE}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(entity);
            }}
          >
            <span style={{ fontWeight: 600 }}>{entity.label[locale]}</span>
            <span style={HINT_STYLE}>
              {entity.kind}
              {entity.hint ? ` · ${entity.hint[locale]}` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}
