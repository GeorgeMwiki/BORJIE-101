'use client';

/**
 * CommandPalette - Wave SUPERPOWERS universal Cmd-K palette.
 *
 * Mounted in all three web apps (admin / owner / marketing if needed)
 * via the root layout. Owner / admin gets the fully-loaded catalog
 * supplied via props - this component is presentation-only.
 *
 * Keyboard shortcut: Cmd-K (mac) / Ctrl-K (win).
 *
 * Categories rendered in order:
 *   - Recent
 *   - Navigate
 *   - Actions
 *   - Spawn tab
 *   - Settings
 *
 * Fuzzy matching: lightweight char-rank score (no external dep). For
 * O(items × query) cost on a few hundred entries this stays well
 * under 1ms on warm devices and avoids pulling Fuse.js into the design
 * system bundle.
 */

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '../lib/utils';

export type CommandKind =
  | 'navigate'
  | 'action'
  | 'recent'
  | 'spawn_tab'
  | 'settings'
  | 'signout';

export interface CommandItem {
  readonly id: string;
  readonly kind: CommandKind;
  readonly label: string;
  readonly hint?: string;
  readonly keywords?: ReadonlyArray<string>;
  readonly onSelect: () => void | Promise<void>;
}

export interface CommandPaletteProps {
  /** Full catalog (Navigate + Actions + Recent + Spawn tab + Settings). */
  readonly items: ReadonlyArray<CommandItem>;
  /** Placeholder text in the search input. */
  readonly placeholder?: string;
  /** Optional className on the outer dialog content. */
  readonly className?: string;
  /** Optional bilingual label-pair to show above each category header. */
  readonly labels?: {
    readonly recent?: string;
    readonly navigate?: string;
    readonly action?: string;
    readonly spawn_tab?: string;
    readonly settings?: string;
    readonly signout?: string;
    readonly empty?: string;
  };
}

const CATEGORY_ORDER: ReadonlyArray<CommandKind> = [
  'recent',
  'navigate',
  'action',
  'spawn_tab',
  'settings',
  'signout',
];

function score(query: string, item: CommandItem): number {
  if (!query) return 1;
  const q = query.toLowerCase().trim();
  const haystack = [
    item.label.toLowerCase(),
    ...(item.hint ? [item.hint.toLowerCase()] : []),
    ...(item.keywords ?? []).map((k) => k.toLowerCase()),
  ].join(' ');
  if (haystack.includes(q)) return 2; // direct substring wins
  // Char-rank: every char in q must appear in order in haystack
  let qi = 0;
  for (let i = 0; i < haystack.length && qi < q.length; i += 1) {
    if (haystack[i] === q[qi]) qi += 1;
  }
  return qi === q.length ? 1 : 0;
}

function useGlobalShortcut(onOpen: () => void): void {
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (e: KeyboardEvent) => {
      const isModK =
        (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K');
      if (isModK) {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onOpen]);
}

export function CommandPalette({
  items,
  placeholder = 'Type a command or search...',
  className,
  labels,
}: CommandPaletteProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  useGlobalShortcut(() => setOpen(true));

  const filtered = React.useMemo(() => {
    const scored = items
      .map((item) => ({ item, s: score(query, item) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    return scored.map((x) => x.item);
  }, [items, query]);

  const grouped = React.useMemo(() => {
    const map = new Map<CommandKind, CommandItem[]>();
    for (const kind of CATEGORY_ORDER) map.set(kind, []);
    for (const item of filtered) {
      const bucket = map.get(item.kind);
      if (bucket) bucket.push(item);
    }
    return map;
  }, [filtered]);

  const onSelect = React.useCallback(async (item: CommandItem) => {
    setOpen(false);
    setQuery('');
    try {
      await item.onSelect();
    } catch {
      // swallow - the harness already navigated/closed
    }
  }, []);

  const categoryLabel = (kind: CommandKind): string => {
    const fallback: Record<CommandKind, string> = {
      recent: 'Recent',
      navigate: 'Navigate',
      action: 'Actions',
      spawn_tab: 'Spawn tab',
      settings: 'Settings',
      signout: 'Sign out',
    };
    if (!labels) return fallback[kind];
    return (
      ((labels as Record<string, string | undefined>)[kind] ??
        fallback[kind])
    );
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-[20%] z-50 w-full max-w-xl -translate-x-1/2 ' +
              'rounded-xl border border-border bg-surface shadow-2xl ' +
              'focus:outline-none',
            className,
          )}
          data-testid="borjie-command-palette"
        >
          <DialogPrimitive.Title className="sr-only">
            Borjie command palette
          </DialogPrimitive.Title>
          <div className="border-b border-border px-3 py-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="w-full bg-transparent text-sm text-foreground placeholder:text-neutral-500 focus:outline-none"
              data-testid="borjie-command-palette-input"
            />
          </div>
          <div className="max-h-[60vh] overflow-y-auto px-1 py-2">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-neutral-500">
                {labels?.empty ?? 'No matches'}
              </p>
            ) : (
              CATEGORY_ORDER.map((kind) => {
                const bucket = grouped.get(kind) ?? [];
                if (bucket.length === 0) return null;
                return (
                  <div key={kind} className="mb-2 last:mb-0">
                    <div className="px-3 py-1 text-tiny uppercase tracking-wide text-neutral-500">
                      {categoryLabel(kind)}
                    </div>
                    <ul className="m-0 list-none p-0">
                      {bucket.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => void onSelect(item)}
                            className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-surface-1 focus:bg-surface-1 focus:outline-none"
                            data-testid={`borjie-command-${item.id}`}
                          >
                            <span className="truncate">{item.label}</span>
                            {item.hint ? (
                              <span className="ml-2 shrink-0 text-tiny text-neutral-500">
                                {item.hint}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })
            )}
          </div>
          <div className="border-t border-border px-3 py-2 text-tiny text-neutral-500">
            Cmd-K to open. Enter to run. Esc to close.
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
