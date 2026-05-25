/**
 * Spotlight React Component — Cmd+K palette shared across all 4 BORJIE apps.
 *
 * Usage:
 *   <Spotlight
 *     userRoles={['OWNER']}
 *     entities={{ units, properties, tenants }}
 *     onAction={(action) => navigate(action.route ?? '/')}
 *   />
 *
 * The component:
 *  - Listens for Cmd+K / Ctrl+K at the window level.
 *  - Opens a centred overlay with a search input + result list.
 *  - Up/Down to navigate results, Enter to execute, Escape to close.
 *  - Delegates execution to the onAction callback — it never navigates
 *    or mutates on its own, so it works identically in Next and Vite.
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  searchSpotlight,
  executeAction,
  SpotlightResult,
  EntityIndex,
} from './spotlight-engine.js';
import type { CatalogAction } from './action-catalog.js';

export interface SpotlightProps {
  readonly userRoles: readonly string[];
  readonly entities?: EntityIndex;
  readonly onAction: (
    action: CatalogAction,
    entity?: SpotlightResult['entity']
  ) => void;
  readonly onPersonaHandoff?: (query: string) => void;
}

export function Spotlight(props: SpotlightProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const results = useMemo(
    () =>
      searchSpotlight(
        { query, userRoles: [...props.userRoles] },
        props.entities
      ),
    [query, props.userRoles, props.entities]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape' && open) setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const run = useCallback(
    (r: SpotlightResult) => {
      if (r.kind === 'action' && r.action) {
        const check = executeAction(r.action.id, props.userRoles);
        if (check.ok) props.onAction(r.action);
        setOpen(false);
        return;
      }
      if (r.kind === 'entity') {
        const dummyAction: CatalogAction = {
          id: `entity:${r.entity?.kind}:${r.entity?.id}`,
          title: r.title,
          description: r.subtitle ?? '',
          keywords: [],
          kind: 'navigation',
          requires: [],
          route: `/${r.entity?.kind}s/${r.entity?.id}`,
        };
        props.onAction(dummyAction, r.entity);
        setOpen(false);
        return;
      }
      if (r.kind === 'persona_handoff' && props.onPersonaHandoff) {
        props.onPersonaHandoff(query);
        setOpen(false);
      }
    },
    [props, query]
  );

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      const r = results[cursor];
      if (r) run(r);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="BORJIE Spotlight"
      style={overlayStyle}
      onClick={() => setOpen(false)}
    >
      <div style={paletteStyle} onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Search actions, units, tenants... or ask Mr. Mwikila"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          style={inputStyle}
        />
        <ul style={listStyle} role="listbox">
          {results.map((r, idx) => (
            <li
              key={r.id}
              role="option"
              aria-selected={idx === cursor}
              style={{
                ...rowStyle,
                ...(idx === cursor ? selectedRowStyle : null),
              }}
              onMouseEnter={() => setCursor(idx)}
              onClick={() => run(r)}
            >
              <div style={{ fontWeight: 600 }}>{r.title}</div>
              {r.subtitle && (
                <div style={{ fontSize: 12, color: '#64748b' }}>{r.subtitle}</div>
              )}
            </li>
          ))}
          {results.length === 0 && (
            <li style={{ padding: 12, color: '#64748b' }}>No results.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

const overlayStyle = {
  position: 'fixed' as const,
  inset: 0,
  background: 'rgba(15, 23, 42, 0.55)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  paddingTop: 80,
  zIndex: 9999,
};

const paletteStyle = {
  width: '100%',
  maxWidth: 640,
  background: '#fff',
  borderRadius: 12,
  boxShadow: '0 20px 60px rgba(15, 23, 42, 0.35)',
  overflow: 'hidden' as const,
};

const inputStyle = {
  width: '100%',
  padding: '14px 16px',
  fontSize: 16,
  border: 'none',
  outline: 'none',
  borderBottom: '1px solid #e2e8f0',
};

const listStyle = {
  listStyle: 'none',
  margin: 0,
  padding: 4,
  maxHeight: 360,
  overflowY: 'auto' as const,
};

const rowStyle = {
  padding: '10px 12px',
  borderRadius: 8,
  cursor: 'pointer' as const,
};

const selectedRowStyle = { background: '#ecfdf5' };
