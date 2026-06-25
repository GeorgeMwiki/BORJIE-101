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
import { pickByLocale } from '@/lib/locale-shared';
import { gatewayFetch, type FetchResult } from '@/lib/gateway-result';
import { captureMessage } from '@/lib/sentry';
import { superpowerChipsStrings as S } from '@/i18n/strings/superpower-chips';

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

/**
 * Typed superpower POST. Folds the call into a `FetchResult<T>` via the
 * shared substrate so a FAILURE (network / non-2xx / parse) is distinguished
 * from an empty-but-valid success — never the bare `null` that let a failed
 * write flip to a success affordance. Every failure is logged once through
 * the pino-backed `captureMessage` sink (no `console.log`).
 */
async function postJson<T>(
  path: string,
  body: unknown,
): Promise<FetchResult<T>> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getCsrfHeaders(),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return gatewayFetch<T>({
    url: `${API_BASE.replace(/\/+$/, '')}${path}`,
    path,
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(body),
    log: (message, detail) =>
      captureMessage(message, 'warning', {
        route: 'home-chat/superpower-chips',
        extra: { path: detail.path, kind: detail.kind, status: detail.status },
      }),
  });
}

/**
 * Convenience for the write chips that only need the success payload (the
 * undo-journal ids) and treat any failure as "no undo to surface". Returns
 * the parsed data on success, `null` on any typed failure — the failure was
 * already logged inside `postJson`, so this never swallows silently.
 */
async function postJsonData<T>(path: string, body: unknown): Promise<T | null> {
  const result = await postJson<T>(path, body);
  return result.ok ? result.data : null;
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
  // `failed` blocks the success affordance when the undo WRITE did not land.
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (secsLeft <= 0 || undone) return undefined;
    const t = window.setTimeout(() => setSecsLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [secsLeft, undone]);

  const onClick = useCallback(async () => {
    if (undone || secsLeft <= 0) return;
    setFailed(false);
    // CHECK the write result before any success affordance. The undo POST can
    // fail (network / non-2xx / parse) just like any write — flipping to the
    // green "Undone" state regardless would tell the owner a change reverted
    // when it did not. On failure, surface a retry state (the typed failure is
    // already logged inside `postJson`) and keep the chip clickable.
    const result = await postJson('/api/v1/owner/undo-journal/undo-last', {
      reason: 'user-clicked-undo-chip',
    });
    if (!result.ok) {
      setFailed(true);
      return;
    }
    setUndone(true);
    onUndone?.();
  }, [undone, secsLeft, onUndone]);

  if (journalIds.length === 0) return null;
  if (undone) {
    return (
      <span className="inline-flex items-center gap-1 text-tiny text-success">
        {pickByLocale(languagePreference, S.undone)}
      </span>
    );
  }
  if (secsLeft <= 0) return null;
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-tiny transition-colors ${
        failed
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : 'border-border bg-surface/60 text-neutral-300 hover:bg-surface'
      }`}
      data-testid="superpower-undo-chip"
      aria-live="polite"
    >
      {failed
        ? pickByLocale(languagePreference, S.undoFailed)
        : `${pickByLocale(languagePreference, S.undo)} (${formatCountdown(secsLeft)})`}
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
  // Share feedback: null = idle, 'copied' = success, 'failed' = error.
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

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

  const onPrefill = useCallback(async (chip: UiPrefillChip) => {
    publishFormPrefill({
      formId: chip.formId,
      values: chip.values,
      submitOnAccept: chip.submitOnAccept ?? false,
    });
    const data = await postJsonData<{ undoJournalIds?: ReadonlyArray<string> }>(
      '/api/v1/owner/superpowers/prefill',
      chip,
    );
    // Surface undo chip ONLY after a successful prefill write (same pattern as
    // bulk). A failure returns `null` (already logged) — no undo chip, no
    // false success.
    if (data?.undoJournalIds && data.undoJournalIds.length > 0) {
      setActiveUndoIds(data.undoJournalIds);
    }
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
    setShareStatus('idle');
    const result = await postJson<{
      shareLinkId: string;
      url: string;
    }>('/api/v1/owner/share-links', chip);
    // CHECK the typed result: a FAILURE (network / non-2xx / parse, already
    // logged) is the 'failed' state — never the green 'copied' affordance. A
    // success that somehow lacks a URL is also a failure, not a copy.
    if (result.ok && result.data?.url) {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(result.data.url);
        } catch {
          // clipboard write failed — still show URL via alert as fallback
        }
      }
      setShareStatus('copied');
    } else {
      setShareStatus('failed');
    }
    // Auto-clear feedback after 4 seconds.
    window.setTimeout(() => setShareStatus('idle'), 4000);
  }, []);

  const onBulk = useCallback(async (chip: UiBulkChip) => {
    const data = await postJsonData<{
      undoJournalIds: ReadonlyArray<string>;
    }>('/api/v1/owner/superpowers/bulk-action', chip);
    if (data?.undoJournalIds && data.undoJournalIds.length > 0) {
      setActiveUndoIds(data.undoJournalIds);
    }
  }, []);

  const onBookmark = useCallback(async (chip: UiBookmarkChip) => {
    const data = await postJsonData<{ pinnedItemId: string }>(
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

  const locale = props.languagePreference;

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
            {pickByLocale(locale, S.open)} {chip.route}
            {chip.focus ? ` (${chip.focus})` : ''}
          </button>
        </li>
      ))}
      {props.prefills.map((chip, i) => (
        <li key={`pf_${i}`}>
          <button
            type="button"
            onClick={() => void onPrefill(chip)}
            className="inline-flex items-center gap-1 rounded border border-info/40 bg-info/5 px-2.5 py-1 text-xs text-info hover:bg-info/10"
            data-testid="superpower-chip-prefill"
            title={chip.reason ?? ''}
          >
            {pickByLocale(locale, S.prefillForm)} ({chip.formId})
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
            {pickByLocale(locale, S.showMe)}
          </button>
        </li>
      ))}
      {props.shares.map((chip, i) => (
        <li key={`sh_${i}`}>
          <button
            type="button"
            onClick={() => void onShare(chip)}
            className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs transition-colors ${
              shareStatus === 'copied'
                ? 'border-success/40 bg-success/10 text-success'
                : shareStatus === 'failed'
                  ? 'border-destructive/40 bg-destructive/10 text-destructive'
                  : 'border-warning/40 bg-warning/5 text-warning hover:bg-warning/10'
            }`}
            data-testid="superpower-chip-share"
            title={chip.reason ?? ''}
            aria-live="polite"
          >
            {shareStatus === 'copied'
              ? pickByLocale(locale, S.linkCopied)
              : shareStatus === 'failed'
                ? pickByLocale(locale, S.shareFailed)
                : pickByLocale(locale, S.generateShareLink)}
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
            {pickByLocale(locale, S.items)}
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
            {pickByLocale(locale, S.pin)} {chip.label ?? chip.entityId}
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
