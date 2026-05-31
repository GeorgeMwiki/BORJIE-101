'use client';

/**
 * Wave SUPERPOWERS — admin-web chip renderer.
 *
 * Renders chips for the six chat-callable user superpowers below an
 * admin chat bubble (the equivalent of owner-web's `SuperpowerChips`):
 *
 *   ui_navigate  → "Open /internal/tenants"
 *   ui_prefill   → "Pre-fill form" — publishes to bus + acks endpoint
 *   ui_highlight → "Show me" — publishes to bus
 *   ui_share     → "Generate share link" — POSTs share-link create
 *   ui_bulk      → "Apply admin action to N items" — POSTs admin bulk
 *   ui_bookmark  → "Pin" — POSTs pinned-items
 *
 * The bulk chip is the admin variant — actions hit the dedicated
 * `/admin/superpowers/bulk-action` route. Each successful WRITE chip
 * surfaces a 5-minute Undo chip via `UndoChip`. HIGH-impact admin
 * verbs (suspend/reactivate/activate/export_regulator_pack) land as
 * `pending_approval`; the chip surface signals this with a different
 * badge ("Awaiting 2nd-eye"), making the four-eye flow explicit.
 */

import type { ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { postSuperpowerJson, ADMIN_SUPERPOWER_ENDPOINTS } from './api';
import {
  HIGH_IMPACT_ADMIN_ACTIONS,
  type UiNavigateChip,
  type UiPrefillChip,
  type UiHighlightChip,
  type UiShareChip,
  type UiBulkChip,
  type UiBookmarkChip,
} from './chip-schemas';
import { publishAdminFormPrefill, publishAdminHighlight } from './bus';

// ─── Undo chip ────────────────────────────────────────────────────────

interface UndoChipProps {
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
    await postSuperpowerJson(ADMIN_SUPERPOWER_ENDPOINTS.undoLast, {
      reason: 'admin-clicked-undo-chip',
    });
    setUndone(true);
    onUndone?.();
  }, [undone, secsLeft, onUndone]);

  if (journalIds.length === 0) return null;
  if (undone) {
    return (
      <span className="inline-flex items-center gap-1 text-tiny text-success">
        Undone
      </span>
    );
  }
  if (secsLeft <= 0) return null;
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      className="inline-flex items-center gap-1 rounded border border-border bg-surface/60 px-2 py-0.5 text-tiny text-neutral-300 hover:bg-surface"
      data-testid="admin-superpower-undo-chip"
    >
      Undo ({formatCountdown(secsLeft)})
    </button>
  );
}

// ─── Public renderer ──────────────────────────────────────────────────

export interface AdminSuperpowerChipsProps {
  readonly navigates: ReadonlyArray<UiNavigateChip>;
  readonly prefills: ReadonlyArray<UiPrefillChip>;
  readonly highlights: ReadonlyArray<UiHighlightChip>;
  readonly shares: ReadonlyArray<UiShareChip>;
  readonly bulks: ReadonlyArray<UiBulkChip>;
  readonly bookmarks: ReadonlyArray<UiBookmarkChip>;
}

interface BulkResponse {
  readonly undoJournalIds: ReadonlyArray<string>;
  readonly status: 'pending_approval' | 'applied';
  readonly requiresFourEye: boolean;
  readonly processed: number;
  readonly failed: number;
}

export function AdminSuperpowerChips(
  props: AdminSuperpowerChipsProps,
): ReactElement | null {
  const router = useRouter();
  const [activeUndoIds, setActiveUndoIds] = useState<ReadonlyArray<string>>(
    [],
  );
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);

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
    publishAdminFormPrefill({
      formId: chip.formId,
      values: chip.values,
      submitOnAccept: chip.submitOnAccept ?? false,
    });
    void postSuperpowerJson(ADMIN_SUPERPOWER_ENDPOINTS.prefillAck, chip);
  }, []);

  const onHighlight = useCallback((chip: UiHighlightChip) => {
    publishAdminHighlight({
      selector: chip.selector,
      message: chip.message,
      ttl: chip.ttl ?? 8000,
      tone: chip.tone ?? 'info',
    });
  }, []);

  const onShare = useCallback(async (chip: UiShareChip) => {
    const data = await postSuperpowerJson<{
      readonly shareLinkId: string;
      readonly url: string;
    }>(ADMIN_SUPERPOWER_ENDPOINTS.shareLinkCreate, chip);
    if (data?.url && typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(data.url);
    }
  }, []);

  const onBulk = useCallback(async (chip: UiBulkChip) => {
    const data = await postSuperpowerJson<BulkResponse>(
      ADMIN_SUPERPOWER_ENDPOINTS.adminBulkAction,
      chip,
    );
    if (data?.undoJournalIds && data.undoJournalIds.length > 0) {
      setActiveUndoIds(data.undoJournalIds);
    }
    if (data?.requiresFourEye) {
      setPendingApprovalCount(data.processed);
    }
  }, []);

  const onBookmark = useCallback(async (chip: UiBookmarkChip) => {
    const data = await postSuperpowerJson<{ pinnedItemId: string }>(
      ADMIN_SUPERPOWER_ENDPOINTS.bookmarkPin,
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
  if (total === 0 && activeUndoIds.length === 0 && pendingApprovalCount === 0)
    return null;

  return (
    <ul
      className="m-0 flex list-none flex-wrap gap-1.5 p-0 pl-10"
      data-testid="admin-superpower-chip-row"
    >
      {props.navigates.map((chip, i) => (
        <li key={`nav_${i}`}>
          <button
            type="button"
            onClick={() => onNavigate(chip)}
            className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning/5 px-2.5 py-1 text-xs text-warning hover:bg-warning/10"
            data-testid="admin-superpower-chip-navigate"
            title={chip.reason}
          >
            Open {chip.route}
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
            data-testid="admin-superpower-chip-prefill"
            title={chip.reason ?? ''}
          >
            Pre-fill form ({chip.formId})
          </button>
        </li>
      ))}
      {props.highlights.map((chip, i) => (
        <li key={`hl_${i}`}>
          <button
            type="button"
            onClick={() => onHighlight(chip)}
            className="inline-flex items-center gap-1 rounded border border-border bg-surface/60 px-2.5 py-1 text-xs text-neutral-300 hover:bg-surface"
            data-testid="admin-superpower-chip-highlight"
          >
            Show me
          </button>
        </li>
      ))}
      {props.shares.map((chip, i) => (
        <li key={`sh_${i}`}>
          <button
            type="button"
            onClick={() => void onShare(chip)}
            className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning/5 px-2.5 py-1 text-xs text-warning hover:bg-warning/10"
            data-testid="admin-superpower-chip-share"
            title={chip.reason ?? ''}
          >
            Generate share link
          </button>
        </li>
      ))}
      {props.bulks.map((chip, i) => {
        const isHighImpact = HIGH_IMPACT_ADMIN_ACTIONS.has(chip.action);
        return (
          <li key={`bk_${i}`}>
            <button
              type="button"
              onClick={() => void onBulk(chip)}
              className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs ${
                isHighImpact
                  ? 'border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10'
                  : 'border-warning/40 bg-warning/5 text-warning hover:bg-warning/10'
              }`}
              data-testid="admin-superpower-chip-bulk"
              title={chip.reason}
            >
              {chip.action} {chip.ids.length} {chip.entityType.replace(/_/g, ' ')}
              {isHighImpact ? ' (needs 2nd-eye)' : ''}
            </button>
          </li>
        );
      })}
      {props.bookmarks.map((chip, i) => (
        <li key={`bm_${i}`}>
          <button
            type="button"
            onClick={() => void onBookmark(chip)}
            className="inline-flex items-center gap-1 rounded border border-success/40 bg-success/5 px-2.5 py-1 text-xs text-success hover:bg-success/10"
            data-testid="admin-superpower-chip-bookmark"
            title={chip.reason ?? ''}
          >
            Pin {chip.label ?? chip.entityId}
          </button>
        </li>
      ))}
      {pendingApprovalCount > 0 ? (
        <li>
          <span
            className="inline-flex items-center gap-1 rounded border border-destructive/40 bg-destructive/5 px-2 py-0.5 text-tiny text-destructive"
            data-testid="admin-superpower-pending-approval-chip"
          >
            {pendingApprovalCount} pending 2nd-eye approval
          </span>
        </li>
      ) : null}
      {activeUndoIds.length > 0 ? (
        <li>
          <UndoChip
            journalIds={activeUndoIds}
            onUndone={() => setActiveUndoIds([])}
          />
        </li>
      ) : null}
    </ul>
  );
}
