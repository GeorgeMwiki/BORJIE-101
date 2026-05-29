'use client';

/**
 * SuperpowerChips - Wave SUPERPOWERS FE renderer.
 *
 * Renders one chip per parsed superpower SSE event below the assistant
 * bubble. Six families:
 *
 *   ui_navigate  -> "Open Licences (expiring-90d)"
 *   ui_prefill   -> "Apply these to the form"
 *   ui_highlight -> "Show me the tip"
 *   ui_share     -> "Generate share link"
 *   ui_bulk      -> "Apply to N items"
 *   ui_bookmark  -> "Pin to quick access"
 *
 * Click semantics:
 *   - navigate    -> next/router.push(route + scoped params)
 *   - prefill     -> publishes to formPrefillBus + dispatches event
 *   - highlight   -> publishes to highlightBus
 *   - share       -> POSTs /api/v1/owner/share-links and copies URL
 *   - bulk        -> POSTs /api/v1/owner/superpowers/bulk-action
 *   - bookmark    -> POSTs /api/v1/owner/pinned-items
 *
 * Each successful WRITE chip surfaces an "Undo (4:58)" countdown chip
 * via UndoChip beneath the chip the owner just clicked.
 */

import type { ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { API_BASE } from '@/lib/brain-api';
import { getCsrfHeaders } from '@/lib/csrf';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

// ─── Schemas (mirrors services/api-gateway/src/routes/ui-navigate-parser.ts) ─

const bilingual = z
  .object({ en: z.string().min(1), sw: z.string().min(1) })
  .strict();

export const uiNavigateChipSchema = z
  .object({
    route: z.string().regex(/^\//),
    scopeIds: z.array(z.string()).optional(),
    focus: z.string().optional(),
    ttl: z.number().int().optional(),
    reason: z.string().min(1),
  })
  .strict();
export type UiNavigateChip = z.infer<typeof uiNavigateChipSchema>;

export const uiPrefillChipSchema = z
  .object({
    formId: z.string().min(1),
    values: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    ),
    submitOnAccept: z.boolean().optional(),
    reason: z.string().optional(),
  })
  .strict();
export type UiPrefillChip = z.infer<typeof uiPrefillChipSchema>;

export const uiHighlightChipSchema = z
  .object({
    selector: z.string().min(1),
    message: bilingual,
    ttl: z.number().int().optional(),
    tone: z
      .enum(['info', 'success', 'warning', 'critical'])
      .optional(),
  })
  .strict();
export type UiHighlightChip = z.infer<typeof uiHighlightChipSchema>;

export const uiShareChipSchema = z
  .object({
    entityType: z.string().min(1),
    entityId: z.string().min(1),
    recipients: z.array(z.string().email()).optional(),
    expiresInHours: z.number().int(),
    permission: z.enum(['read', 'comment', 'edit']),
    reason: z.string().optional(),
  })
  .strict();
export type UiShareChip = z.infer<typeof uiShareChipSchema>;

export const uiBulkChipSchema = z
  .object({
    entityType: z.string().min(1),
    ids: z.array(z.string()).min(1),
    action: z.string().min(1),
    payload: z.record(z.string(), z.unknown()).optional(),
    reason: z.string().min(1),
  })
  .strict();
export type UiBulkChip = z.infer<typeof uiBulkChipSchema>;

export const uiBookmarkChipSchema = z
  .object({
    entityType: z.string().min(1),
    entityId: z.string().min(1),
    label: z.string().optional(),
    reason: z.string().optional(),
  })
  .strict();
export type UiBookmarkChip = z.infer<typeof uiBookmarkChipSchema>;

// ─── Cross-component bus (used by ui_prefill / ui_highlight) ──────────

type FormPrefillEvent = { formId: string; values: Record<string, unknown>; submitOnAccept: boolean };
type HighlightEvent = {
  selector: string;
  message: { en: string; sw: string };
  ttl: number;
  tone: 'info' | 'success' | 'warning' | 'critical';
};

export const FORM_PREFILL_EVENT_NAME = 'borjie:form-prefill';
export const HIGHLIGHT_EVENT_NAME = 'borjie:highlight';

export function publishFormPrefill(payload: FormPrefillEvent): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(FORM_PREFILL_EVENT_NAME, { detail: payload }),
  );
}

export function publishHighlight(payload: HighlightEvent): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(HIGHLIGHT_EVENT_NAME, { detail: payload }),
  );
}

// ─── HTTP helpers ─────────────────────────────────────────────────────

async function getAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const token = await getAccessToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...getCsrfHeaders(),
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API_BASE.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { success?: boolean; data?: T };
    return json.success && json.data ? json.data : null;
  } catch {
    return null;
  }
}

// ─── Undo chip ────────────────────────────────────────────────────────

interface UndoChipProps {
  readonly languagePreference: 'sw' | 'en';
  readonly journalIds: ReadonlyArray<string>;
  readonly windowSeconds?: number;
  readonly onUndone?: () => void;
}

function formatCountdown(secsLeft: number): string {
  const m = Math.floor(secsLeft / 60);
  const s = secsLeft % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function UndoChip({
  languagePreference,
  journalIds,
  windowSeconds = 300,
  onUndone,
}: UndoChipProps): ReactElement | null {
  const [secsLeft, setSecsLeft] = useState(windowSeconds);
  const [undone, setUndone] = useState(false);

  useEffect(() => {
    if (secsLeft <= 0 || undone) return undefined;
    const t = window.setTimeout(() => setSecsLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [secsLeft, undone]);

  const onClick = useCallback(async () => {
    if (undone || secsLeft <= 0) return;
    await postJson('/api/v1/owner/undo-journal/undo-last', {
      reason: 'user-clicked-undo-chip',
    });
    setUndone(true);
    onUndone?.();
  }, [undone, secsLeft, onUndone]);

  if (journalIds.length === 0) return null;
  if (undone) {
    return (
      <span className="inline-flex items-center gap-1 text-tiny text-success">
        {languagePreference === 'sw' ? 'Imeghairiwa' : 'Undone'}
      </span>
    );
  }
  if (secsLeft <= 0) return null;
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      className="inline-flex items-center gap-1 rounded border border-border bg-surface/60 px-2 py-0.5 text-tiny text-neutral-300 hover:bg-surface"
      data-testid="superpower-undo-chip"
    >
      {languagePreference === 'sw' ? 'Tendua' : 'Undo'} ({formatCountdown(secsLeft)})
    </button>
  );
}

// ─── Public renderer ──────────────────────────────────────────────────

export interface SuperpowerChipsProps {
  readonly languagePreference: 'sw' | 'en';
  readonly navigates: ReadonlyArray<UiNavigateChip>;
  readonly prefills: ReadonlyArray<UiPrefillChip>;
  readonly highlights: ReadonlyArray<UiHighlightChip>;
  readonly shares: ReadonlyArray<UiShareChip>;
  readonly bulks: ReadonlyArray<UiBulkChip>;
  readonly bookmarks: ReadonlyArray<UiBookmarkChip>;
}

export function SuperpowerChips(props: SuperpowerChipsProps): ReactElement | null {
  const router = useRouter();
  const [activeUndoIds, setActiveUndoIds] = useState<ReadonlyArray<string>>([]);

  const onNavigate = useCallback(
    (chip: UiNavigateChip) => {
      const url = new URL(chip.route, window.location.origin);
      if (chip.scopeIds && chip.scopeIds.length > 0) {
        url.searchParams.set('scope', chip.scopeIds.join(','));
      }
      if (chip.focus) url.searchParams.set('focus', chip.focus);
      router.push(`${url.pathname}${url.search}`);
    },
    [router],
  );

  const onPrefill = useCallback((chip: UiPrefillChip) => {
    publishFormPrefill({
      formId: chip.formId,
      values: chip.values,
      submitOnAccept: chip.submitOnAccept ?? false,
    });
    void postJson('/api/v1/owner/superpowers/prefill', chip);
  }, []);

  const onHighlight = useCallback((chip: UiHighlightChip) => {
    publishHighlight({
      selector: chip.selector,
      message: chip.message,
      ttl: chip.ttl ?? 8000,
      tone: chip.tone ?? 'info',
    });
  }, []);

  const onShare = useCallback(async (chip: UiShareChip) => {
    const data = await postJson<{
      shareLinkId: string;
      url: string;
    }>('/api/v1/owner/share-links', chip);
    if (data?.url && typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(data.url);
    }
  }, []);

  const onBulk = useCallback(async (chip: UiBulkChip) => {
    const data = await postJson<{
      undoJournalIds: ReadonlyArray<string>;
    }>('/api/v1/owner/superpowers/bulk-action', chip);
    if (data?.undoJournalIds && data.undoJournalIds.length > 0) {
      setActiveUndoIds(data.undoJournalIds);
    }
  }, []);

  const onBookmark = useCallback(async (chip: UiBookmarkChip) => {
    const data = await postJson<{ pinnedItemId: string }>(
      '/api/v1/owner/pinned-items',
      chip,
    );
    if (data?.pinnedItemId) {
      setActiveUndoIds([data.pinnedItemId]);
    }
  }, []);

  const total =
    props.navigates.length +
    props.prefills.length +
    props.highlights.length +
    props.shares.length +
    props.bulks.length +
    props.bookmarks.length;
  if (total === 0) return null;

  const sw = props.languagePreference === 'sw';

  return (
    <ul
      className="m-0 flex list-none flex-wrap gap-1.5 p-0 pl-10"
      data-testid="superpower-chip-row"
    >
      {props.navigates.map((chip, i) => (
        <li key={`nav_${i}`}>
          <button
            type="button"
            onClick={() => onNavigate(chip)}
            className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning/5 px-2.5 py-1 text-xs text-warning hover:bg-warning/10"
            data-testid="superpower-chip-navigate"
            title={chip.reason}
          >
            {sw ? 'Fungua' : 'Open'} {chip.route}
            {chip.focus ? ` (${chip.focus})` : ''}
          </button>
        </li>
      ))}
      {props.prefills.map((chip, i) => (
        <li key={`pf_${i}`}>
          <button
            type="button"
            onClick={() => onPrefill(chip)}
            className="inline-flex items-center gap-1 rounded border border-info/40 bg-info/5 px-2.5 py-1 text-xs text-info hover:bg-info/10"
            data-testid="superpower-chip-prefill"
            title={chip.reason ?? ''}
          >
            {sw ? 'Jaza fomu' : 'Pre-fill form'} ({chip.formId})
          </button>
        </li>
      ))}
      {props.highlights.map((chip, i) => (
        <li key={`hl_${i}`}>
          <button
            type="button"
            onClick={() => onHighlight(chip)}
            className="inline-flex items-center gap-1 rounded border border-border bg-surface/60 px-2.5 py-1 text-xs text-neutral-300 hover:bg-surface"
            data-testid="superpower-chip-highlight"
          >
            {sw ? 'Onyesha kidokezo' : 'Show me'}
          </button>
        </li>
      ))}
      {props.shares.map((chip, i) => (
        <li key={`sh_${i}`}>
          <button
            type="button"
            onClick={() => void onShare(chip)}
            className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning/5 px-2.5 py-1 text-xs text-warning hover:bg-warning/10"
            data-testid="superpower-chip-share"
            title={chip.reason ?? ''}
          >
            {sw ? 'Tengeneza kiungo' : 'Generate share link'}
          </button>
        </li>
      ))}
      {props.bulks.map((chip, i) => (
        <li key={`bk_${i}`}>
          <button
            type="button"
            onClick={() => void onBulk(chip)}
            className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning/5 px-2.5 py-1 text-xs text-warning hover:bg-warning/10"
            data-testid="superpower-chip-bulk"
            title={chip.reason}
          >
            {chip.action} {chip.ids.length}{' '}
            {sw ? 'vitu' : 'items'}
          </button>
        </li>
      ))}
      {props.bookmarks.map((chip, i) => (
        <li key={`bm_${i}`}>
          <button
            type="button"
            onClick={() => void onBookmark(chip)}
            className="inline-flex items-center gap-1 rounded border border-success/40 bg-success/5 px-2.5 py-1 text-xs text-success hover:bg-success/10"
            data-testid="superpower-chip-bookmark"
            title={chip.reason ?? ''}
          >
            {sw ? 'Bandika' : 'Pin'} {chip.label ?? chip.entityId}
          </button>
        </li>
      ))}
      {activeUndoIds.length > 0 ? (
        <li>
          <UndoChip
            languagePreference={props.languagePreference}
            journalIds={activeUndoIds}
            onUndone={() => setActiveUndoIds([])}
          />
        </li>
      ) : null}
    </ul>
  );
}
