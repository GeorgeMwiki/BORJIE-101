'use client';

/**
 * SpawnTabMenu — the "+" dropdown that opens new tabs in the cockpit.
 *
 * Wave OWNER-OS-DYNAMIC.
 *
 * Phase 1 surfaced every registered tab type with a searchable picker
 * + Cmd+T keyboard flow.
 *
 * Phase 2 MINIMISES the surface: the default state shows ONLY the tab
 * types the owner has spawned in the last 30 days, ordered by recency.
 * The full 14-tab registry is revealed behind a small "Show all" link
 * so power users still have the full set one click away. Empty state
 * (no recent types yet) shows a "Tell Mr. Mwikila what you need"
 * caption + a one-line input that hands the text to the brain — the
 * model then emits `<spawn_tabs>` on its reply and a chip appears for
 * the owner to confirm.
 *
 * BRAIN BACKEND AWARENESS IS INTENTIONALLY UNAFFECTED. The teaching-
 * prompt extension reminds the model that all 14 tab types exist and it
 * can suggest any of them based on the conversation. This menu only
 * trims the MANUAL "+ Tab" affordance to recently-used types.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { Plus, Search, Send, Sparkles, X } from 'lucide-react';
import {
  listSpawnableTabs,
  matchIntent,
  type OwnerOSTabDescriptor,
  type OwnerOSTabType,
} from '@borjie/owner-os-tabs';
import { resolveIcon } from './panels/icon-map';
import {
  useRecentlySpawnedTabTypes,
  type RecentTabType,
} from './useRecentlySpawnedTabTypes';

export interface SpawnTabMenuProps {
  readonly languagePreference: 'sw' | 'en';
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSpawn: (descriptor: OwnerOSTabDescriptor) => void;
  /**
   * Optional — when the owner uses the empty-state ask box, the shell
   * hands the prompt to the brain so it can emit a `<spawn_tabs>` chip
   * on the next reply. When omitted, the empty-state input is hidden.
   */
  readonly onAskBrain?: (prompt: string) => void;
}

interface MenuRow {
  readonly descriptor: OwnerOSTabDescriptor;
  /** ISO 8601 — null when the descriptor came from "Show all". */
  readonly lastOpenedAt: string | null;
}

function copy(lang: 'sw' | 'en') {
  if (lang === 'sw') {
    return {
      placeholder: 'Tafuta tab… (mfano: utii, hatari, hazina)',
      recent: 'Hivi karibuni',
      showAll: 'Onyesha zote',
      hideAll: 'Onyesha za hivi karibuni tu',
      allHelp: 'Aina zote 14 za tab',
      emptyTitle: 'Bado hujafungua tab yoyote',
      emptyHelp:
        'Mwambie Bw. Mwikila unahitaji nini, na atafungua tab sahihi.',
      askPlaceholder: 'mfano: onyesha NEMC ya Geita',
      askSend: 'Tuma kwa Bw. Mwikila',
      navigate: 'sogea',
      open: 'fungua',
      close: 'funga',
      shortcut: 'Bonyeza Cmd+T kufungua haraka',
      noMatch: 'Hakuna tab inayolingana',
      footerHelp: 'Aina zote zinaonekana kwa "Onyesha zote".',
    } as const;
  }
  return {
    placeholder: 'Search a tab… (e.g. compliance, risk, treasury)',
    recent: 'Recent',
    showAll: 'Show all',
    hideAll: 'Show recent only',
    allHelp: 'All 14 tab types',
    emptyTitle: 'No tabs spawned yet',
    emptyHelp:
      "Tell Mr. Mwikila what you need and he will open the right tab for you.",
    askPlaceholder: 'e.g. show me NEMC for Geita',
    askSend: 'Send to Mr. Mwikila',
    navigate: 'navigate',
    open: 'open',
    close: 'close',
    shortcut: 'Press Cmd+T to open quickly',
    noMatch: 'No matching tab',
    footerHelp: 'Full set is one click away under "Show all".',
  } as const;
}

function rowsFromRecent(
  recent: ReadonlyArray<RecentTabType>,
  descriptors: ReadonlyArray<OwnerOSTabDescriptor>,
): ReadonlyArray<MenuRow> {
  const byType = new Map<OwnerOSTabType, OwnerOSTabDescriptor>();
  for (const d of descriptors) byType.set(d.type, d);
  const rows: MenuRow[] = [];
  for (const entry of recent) {
    const d = byType.get(entry.type as OwnerOSTabType);
    if (!d) continue;
    rows.push({ descriptor: d, lastOpenedAt: entry.lastOpenedAt });
  }
  return rows;
}

export function SpawnTabMenu({
  languagePreference,
  open,
  onClose,
  onSpawn,
  onAskBrain,
}: SpawnTabMenuProps): ReactElement | null {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [askDraft, setAskDraft] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const { types: recent, loading } = useRecentlySpawnedTabTypes(30);
  const allDescriptors = useMemo(() => listSpawnableTabs(), []);
  const recentRows = useMemo(
    () => rowsFromRecent(recent, allDescriptors),
    [recent, allDescriptors],
  );

  useEffect(() => {
    if (open) {
      setQuery('');
      setAskDraft('');
      // Reset to recent-only when re-opened, unless the owner has no
      // recent tabs yet — in which case "Show all" stays expanded so
      // the picker is always useful on a fresh sign-in.
      setShowAll(recentRows.length === 0);
      setActiveIndex(0);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open, recentRows.length]);

  const allRanked = useMemo<ReadonlyArray<OwnerOSTabDescriptor>>(() => {
    if (query.trim().length > 0) {
      return matchIntent(
        { filterQuery: query },
        { locale: languagePreference },
      ).map((m) => m.descriptor);
    }
    return allDescriptors;
  }, [query, languagePreference, allDescriptors]);

  // Visible rows depend on showAll + query. When the owner is searching,
  // we ALWAYS scan the full registry so a power-user search is never
  // blocked by the minimal default.
  const visibleRows = useMemo<ReadonlyArray<MenuRow>>(() => {
    if (query.trim().length > 0) {
      return allRanked.map((d) => ({ descriptor: d, lastOpenedAt: null }));
    }
    if (showAll) {
      return allDescriptors.map((d) => ({ descriptor: d, lastOpenedAt: null }));
    }
    return recentRows;
  }, [allRanked, allDescriptors, recentRows, query, showAll]);

  useEffect(() => {
    if (activeIndex >= visibleRows.length) setActiveIndex(0);
  }, [visibleRows.length, activeIndex]);

  const captions = copy(languagePreference);

  const handleSpawn = useCallback(
    (d: OwnerOSTabDescriptor) => {
      onSpawn(d);
      onClose();
    },
    [onSpawn, onClose],
  );

  const handleAsk = useCallback(() => {
    const trimmed = askDraft.trim();
    if (!trimmed || !onAskBrain) return;
    onAskBrain(trimmed);
    onClose();
  }, [askDraft, onAskBrain, onClose]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % Math.max(visibleRows.length, 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(
          (i) => (i - 1 + visibleRows.length) % Math.max(visibleRows.length, 1),
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const d = visibleRows[activeIndex]?.descriptor;
        if (d) handleSpawn(d);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [visibleRows, activeIndex, handleSpawn, onClose],
  );

  if (!open) return null;

  const showEmptyState =
    !showAll &&
    query.trim().length === 0 &&
    recentRows.length === 0 &&
    !loading;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={
        languagePreference === 'sw' ? 'Menyu ya kufungua tab' : 'Spawn tab menu'
      }
      onKeyDown={onKeyDown}
      data-testid="owner-os-spawn-menu"
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/80 backdrop-blur-sm"
    >
      <button
        type="button"
        aria-label={languagePreference === 'sw' ? 'Funga' : 'Close'}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div
        className="relative z-10 mt-24 w-full max-w-xl rounded-2xl border border-warning/30 bg-surface shadow-2xl"
        data-testid="owner-os-spawn-menu-panel"
      >
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search aria-hidden="true" className="h-4 w-4 text-warning" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={captions.placeholder}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-neutral-500 focus:outline-none"
            data-testid="owner-os-spawn-menu-input"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={languagePreference === 'sw' ? 'Funga' : 'Close'}
            className="rounded p-1 text-neutral-500 hover:bg-surface/60 hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        {/* Recent-only mode: a tiny eyebrow tells the owner what we're showing. */}
        {!showAll && query.trim().length === 0 ? (
          <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2">
            <span className="text-tiny font-semibold uppercase tracking-wider text-neutral-400">
              {recentRows.length > 0 ? captions.recent : captions.emptyTitle}
            </span>
            <button
              type="button"
              onClick={() => setShowAll(true)}
              data-testid="owner-os-spawn-show-all"
              className="inline-flex items-center gap-1 text-tiny font-medium text-warning hover:underline"
            >
              {captions.showAll}
            </button>
          </div>
        ) : null}

        {/* Show-all mode: explicit eyebrow + collapse affordance. */}
        {showAll && query.trim().length === 0 ? (
          <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2">
            <span className="text-tiny font-semibold uppercase tracking-wider text-neutral-400">
              {captions.allHelp}
            </span>
            <button
              type="button"
              onClick={() => setShowAll(false)}
              data-testid="owner-os-spawn-show-recent"
              className="inline-flex items-center gap-1 text-tiny font-medium text-warning hover:underline"
            >
              {captions.hideAll}
            </button>
          </div>
        ) : null}

        <ul
          role="listbox"
          aria-label={
            languagePreference === 'sw'
              ? 'Tabs zinazoweza kufunguliwa'
              : 'Spawnable tabs'
          }
          className="m-0 max-h-96 overflow-y-auto p-2"
          data-testid={
            showAll || query.trim().length > 0
              ? 'owner-os-spawn-list-all'
              : 'owner-os-spawn-list-recent'
          }
        >
          {showEmptyState ? (
            <li
              className="flex flex-col gap-2 px-3 py-4"
              data-testid="owner-os-spawn-empty"
            >
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Sparkles
                  aria-hidden="true"
                  className="h-3.5 w-3.5 text-warning"
                />
                {captions.emptyTitle}
              </span>
              <p className="text-tiny text-neutral-400">{captions.emptyHelp}</p>
              {onAskBrain ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={askDraft}
                    onChange={(e) => setAskDraft(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAsk();
                      }
                      // Avoid the parent listbox stealing arrows.
                      e.stopPropagation();
                    }}
                    placeholder={captions.askPlaceholder}
                    data-testid="owner-os-spawn-ask"
                    className="flex-1 rounded-md border border-border bg-surface/60 px-2.5 py-1.5 text-xs text-foreground placeholder:text-neutral-500 focus:border-warning focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAsk}
                    disabled={askDraft.trim().length === 0}
                    aria-label={captions.askSend}
                    data-testid="owner-os-spawn-ask-submit"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-warning text-warning-foreground transition hover:opacity-90 disabled:opacity-40"
                  >
                    <Send aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="self-start text-tiny font-medium text-warning hover:underline"
              >
                {captions.showAll}
              </button>
            </li>
          ) : visibleRows.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-neutral-500">
              {captions.noMatch}
            </li>
          ) : (
            visibleRows.map((row, idx) => {
              const d = row.descriptor;
              const Icon = resolveIcon(d.iconName);
              const isActive = idx === activeIndex;
              return (
                <li key={d.type}>
                  <button
                    type="button"
                    onClick={() => handleSpawn(d)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    role="option"
                    aria-selected={isActive}
                    data-testid={`owner-os-spawn-menu-item-${d.type}`}
                    className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition ${
                      isActive
                        ? 'bg-warning/15 text-foreground'
                        : 'hover:bg-surface/60 text-neutral-300'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${
                        isActive ? 'border-warning/40 text-warning' : 'border-border'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium">
                        {languagePreference === 'sw' ? d.labelSw : d.labelEn}
                      </span>
                      <span className="block text-tiny text-neutral-500">
                        {languagePreference === 'sw'
                          ? d.descriptionSw
                          : d.descriptionEn}
                      </span>
                    </span>
                    {row.lastOpenedAt ? (
                      <span className="ml-2 self-center text-tiny text-neutral-500 tabular-nums">
                        {new Date(row.lastOpenedAt).toLocaleDateString()}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <footer className="flex items-center justify-between border-t border-border px-4 py-2 text-tiny text-neutral-500">
          <span className="inline-flex items-center gap-1">
            <Plus className="h-3 w-3" />
            {captions.shortcut}
          </span>
          <span>
            <kbd className="rounded border border-border bg-surface/60 px-1.5 py-0.5 font-mono text-tiny">
              ↑↓
            </kbd>{' '}
            {captions.navigate}{' '}
            <kbd className="rounded border border-border bg-surface/60 px-1.5 py-0.5 font-mono text-tiny">
              Enter
            </kbd>{' '}
            {captions.open}{' '}
            <kbd className="rounded border border-border bg-surface/60 px-1.5 py-0.5 font-mono text-tiny">
              Esc
            </kbd>{' '}
            {captions.close}
          </span>
        </footer>
      </div>
    </div>
  );
}
