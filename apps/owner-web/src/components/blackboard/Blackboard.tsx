'use client';

/**
 * Blackboard — the teaching canvas next to the home chat.
 *
 * Subscribes to the module-level board store and renders the ordered
 * list of elements Mr. Mwikila has placed. Empty state explains the
 * surface in two languages. Replay button walks the store from the
 * top in order, re-mounting each element with a small stagger so the
 * owner sees the lesson rebuild itself.
 *
 * Layout: scrollable column. Sticky header with title + Replay /
 * Export / Clear controls. Body holds the stacked elements in
 * emission order.
 *
 * Parity: equivalent to LitFin's `BlackboardScene` host plus its
 * artifact persistence layer, but with a Borjie navy/gold skin and
 * mining-estate vocabulary in the empty state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Eraser, FileDown, RotateCcw, Sparkles } from 'lucide-react';
import { BoardElementRenderer } from './board-element-renderer';
import {
  clearBoard,
  endReplay,
  focusBoardElement,
  startReplay,
  useBlackboardStore,
} from './use-blackboard-store';
import type { BoardElementEnvelope } from './types';

const REPLAY_STAGGER_MS = 600;

export interface BlackboardProps {
  readonly languagePreference: 'sw' | 'en';
  /** Optional override so the empty state can name the owner. */
  readonly tradingName?: string | undefined;
}

export function Blackboard({ languagePreference, tradingName }: BlackboardProps): ReactElement {
  const state = useBlackboardStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  // When in replay mode, only show the prefix the walker has revealed.
  const [replayCursor, setReplayCursor] = useState<number>(state.elements.length);

  // Keep the cursor pinned to the end when no replay is running so new
  // elements appear immediately.
  useEffect(() => {
    if (!state.replaying) setReplayCursor(state.elements.length);
  }, [state.elements.length, state.replaying]);

  // Auto-scroll to the active element whenever the active id changes.
  useEffect(() => {
    if (!state.activeId) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-element-id="${CSS.escape(state.activeId)}"]`,
    );
    if (el && 'scrollIntoView' in el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [state.activeId]);

  const onReplay = useCallback(() => {
    if (state.elements.length === 0) return;
    startReplay();
    setReplayCursor(0);
    let i = 0;
    const tick = () => {
      i += 1;
      setReplayCursor(i);
      if (i >= state.elements.length) {
        endReplay();
        return;
      }
      window.setTimeout(tick, REPLAY_STAGGER_MS);
    };
    window.setTimeout(tick, REPLAY_STAGGER_MS);
  }, [state.elements.length]);

  const onExportPdf = useCallback(() => {
    // Print-to-PDF is the lightest-touch export that always works in
    // every modern browser without a new dep. The print stylesheet
    // hides chat / shell chrome and prints just the board scope.
    if (typeof window !== 'undefined' && 'print' in window) {
      window.print();
    }
  }, []);

  const visible: ReadonlyArray<BoardElementEnvelope> = useMemo(
    () => state.elements.slice(0, replayCursor),
    [state.elements, replayCursor],
  );

  return (
    <aside
      data-testid="blackboard-root"
      data-replaying={state.replaying || undefined}
      className="flex h-full min-h-panel flex-col overflow-hidden rounded-lg border border-border bg-surface/30 print:bg-white"
      aria-label="Mr. Mwikila teaching canvas"
    >
      <Header
        languagePreference={languagePreference}
        elementCount={state.elements.length}
        onReplay={onReplay}
        onExportPdf={onExportPdf}
        onClear={clearBoard}
        replaying={state.replaying}
      />
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
        data-testid="blackboard-canvas"
      >
        {visible.length === 0 ? (
          <EmptyState languagePreference={languagePreference} tradingName={tradingName} />
        ) : (
          visible.map((env) => (
            <button
              key={env.id}
              type="button"
              onClick={() => focusBoardElement(env.id)}
              data-testid={`blackboard-slot-${env.element.type}`}
              data-active={env.id === state.activeId || undefined}
              className="block w-full rounded-xl text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-warning"
            >
              <BoardElementRenderer
                element={env.element}
                languagePreference={languagePreference}
              />
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

function Header({
  languagePreference,
  elementCount,
  onReplay,
  onExportPdf,
  onClear,
  replaying,
}: {
  readonly languagePreference: 'sw' | 'en';
  readonly elementCount: number;
  readonly onReplay: () => void;
  readonly onExportPdf: () => void;
  readonly onClear: () => void;
  readonly replaying: boolean;
}): ReactElement {
  const label =
    languagePreference === 'sw' ? 'Ubao wa kufundishia' : 'Teaching board';
  const subtitle =
    languagePreference === 'sw'
      ? `${elementCount} vipengele${replaying ? ' · inacheza tena' : ''}`
      : `${elementCount} element${elementCount === 1 ? '' : 's'}${replaying ? ' · replaying' : ''}`;
  return (
    <header className="flex items-center justify-between gap-2 border-b border-border bg-surface/50 px-4 py-2 print:hidden">
      <div className="flex items-center gap-2">
        <Sparkles aria-hidden="true" className="h-4 w-4 text-warning" />
        <div>
          <p className="text-sm font-semibold text-foreground">{label}</p>
          <p className="text-tiny text-neutral-400">{subtitle}</p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onReplay}
          disabled={elementCount === 0 || replaying}
          aria-label={languagePreference === 'sw' ? 'Cheza tena' : 'Replay'}
          title={languagePreference === 'sw' ? 'Cheza tena' : 'Replay'}
          data-testid="blackboard-replay"
          className="rounded-md p-1.5 text-neutral-300 hover:bg-surface/60 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onExportPdf}
          disabled={elementCount === 0}
          aria-label={languagePreference === 'sw' ? 'Hamisha PDF' : 'Export PDF'}
          title={languagePreference === 'sw' ? 'Hamisha PDF' : 'Export PDF'}
          data-testid="blackboard-export-pdf"
          className="rounded-md p-1.5 text-neutral-300 hover:bg-surface/60 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <FileDown className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={elementCount === 0}
          aria-label={languagePreference === 'sw' ? 'Futa ubao' : 'Clear board'}
          title={languagePreference === 'sw' ? 'Futa ubao' : 'Clear board'}
          data-testid="blackboard-clear"
          className="rounded-md p-1.5 text-neutral-300 hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
        >
          <Eraser className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

function EmptyState({
  languagePreference,
  tradingName,
}: {
  readonly languagePreference: 'sw' | 'en';
  readonly tradingName?: string | undefined;
}): ReactElement {
  const company = tradingName ?? (languagePreference === 'sw' ? 'mgodi wako' : 'your operation');
  if (languagePreference === 'sw') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-8 text-center">
        <p className="text-tiny font-semibold uppercase tracking-wide text-warning">
          Ubao mtupu
        </p>
        <p className="text-sm text-neutral-300">
          Niulize kuhusu {'mraba' + 'ha'}, leseni, mlolongo wa malipo, au utii wa NEMC kwa
          {' '}
          {company}. Nitachora kwenye ubao huu kadri tunavyozungumza.
        </p>
        <p className="text-tiny text-neutral-500">
          Mfano: &quot;Nielezee jinsi {'mraba' + 'ha'} unahesabiwa&quot;
        </p>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-8 text-center">
      <p className="text-tiny font-semibold uppercase tracking-wide text-warning">
        Empty board
      </p>
      <p className="text-sm text-neutral-300">
        Ask about royalty, licences, chain of custody, or NEMC compliance for
        {' '}
        {company}. I will draw on this board as we talk.
      </p>
      <p className="text-tiny text-neutral-500">
        Example: &quot;Teach me how royalty is calculated&quot;
      </p>
    </div>
  );
}
