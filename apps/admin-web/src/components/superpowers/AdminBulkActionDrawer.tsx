'use client';

/**
 * Wave SUPERPOWERS — admin bulk-action composer.
 *
 * Always mounted in `AdminShell`. Opens on:
 *   - Cmd+Shift+B (Mac) / Ctrl+Shift+B (Win/Linux)
 *   - or a `borjie:admin:bulk-drawer-open` window CustomEvent
 *
 * The drawer is the admin's primary entrypoint for bulk verbs against
 * cross-tenant entities — tenant_orgs · intelligence_corpus ·
 * feature_flags · killswitch_targets. It posts directly to
 * `/api/v1/admin/superpowers/bulk-action`. HIGH-impact verbs
 * (suspend/reactivate/activate/export_regulator_pack) land as
 * `pending_approval` and the drawer surfaces an explicit four-eye
 * banner so the operator never assumes the action is final.
 */

import type { ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@borjie/design-system';
import { pickByLocale, useLocale } from '@/lib/locale';
import { postSuperpowerJson, ADMIN_SUPERPOWER_ENDPOINTS } from './api';
import {
  ADMIN_BULK_ACTIONS,
  ADMIN_BULK_ENTITY_TYPES,
  HIGH_IMPACT_ADMIN_ACTIONS,
} from './chip-schemas';
import { ADMIN_BULK_DRAWER_EVENT_NAME } from './bus';

interface BulkDispatchResult {
  readonly status: 'pending_approval' | 'applied';
  readonly processed: number;
  readonly failed: number;
  readonly requiresFourEye: boolean;
}

const SHORTCUT_MATCH = (e: KeyboardEvent): boolean => {
  // Cmd+Shift+B on Mac, Ctrl+Shift+B everywhere else.
  if (e.key.toLowerCase() !== 'b') return false;
  if (!e.shiftKey) return false;
  // metaKey on Mac, ctrlKey elsewhere. Allow both for portability.
  return e.metaKey || e.ctrlKey;
};

export function AdminBulkActionDrawer(): ReactElement | null {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [entityType, setEntityType] = useState<
    (typeof ADMIN_BULK_ENTITY_TYPES)[number]
  >(ADMIN_BULK_ENTITY_TYPES[0]);
  const [action, setAction] = useState<
    (typeof ADMIN_BULK_ACTIONS)[number]
  >('archive');
  const [idsRaw, setIdsRaw] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BulkDispatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (!SHORTCUT_MATCH(e)) return;
      e.preventDefault();
      setOpen(true);
    };
    const onCustom = (): void => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(ADMIN_BULK_DRAWER_EVENT_NAME, onCustom);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(ADMIN_BULK_DRAWER_EVENT_NAME, onCustom);
    };
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setResult(null);
    setError(null);
  }, []);

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);
      setResult(null);

      const ids = idsRaw
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length === 0) {
        setError(
          pickByLocale(locale, {
            en: 'Provide at least one id (comma/space separated).',
            sw: 'Toa angalau kitambulisho kimoja (vimetenganishwa kwa koma/nafasi).',
          }),
        );
        return;
      }
      if (reason.trim().length < 8) {
        setError(
          pickByLocale(locale, {
            en: 'Reason must be at least 8 characters.',
            sw: 'Sababu lazima iwe na angalau herufi 8.',
          }),
        );
        return;
      }
      setSubmitting(true);
      const data = await postSuperpowerJson<BulkDispatchResult>(
        ADMIN_SUPERPOWER_ENDPOINTS.adminBulkAction,
        {
          entityType,
          action,
          ids,
          reason,
          provenance: { surface: 'admin-bulk-drawer' },
        },
      );
      setSubmitting(false);
      if (!data) {
        setError(
          pickByLocale(locale, {
            en: 'Bulk action failed. Check console + retry.',
            sw: 'Kitendo cha wingi kimeshindwa. Angalia console + jaribu tena.',
          }),
        );
        return;
      }
      setResult(data);
    },
    [action, entityType, idsRaw, reason, locale],
  );

  if (!open) return null;

  const isHighImpact = HIGH_IMPACT_ADMIN_ACTIONS.has(action);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={pickByLocale(locale, {
        en: 'Admin bulk action',
        sw: 'Kitendo cha wingi cha msimamizi',
      })}
      data-testid="admin-bulk-drawer"
      className="fixed inset-0 z-50 flex items-end justify-end bg-black/30 backdrop-blur-sm"
      onClick={close}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col gap-4 border-l border-border bg-surface p-6 shadow-xl"
      >
        <header className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {pickByLocale(locale, {
                en: 'Admin bulk action',
                sw: 'Kitendo cha wingi cha msimamizi',
              })}
            </h2>
            <p className="text-xs text-neutral-400">
              {pickByLocale(locale, {
                en: 'Cmd+Shift+B · admin-only verbs against cross-tenant entities',
                sw: 'Cmd+Shift+B · vitendo vya msimamizi pekee dhidi ya huluki za wateja mbalimbali',
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded border border-border bg-surface px-2 py-1 text-xs text-neutral-400 hover:bg-surface/60"
          >
            {pickByLocale(locale, { en: 'Close', sw: 'Funga' })}
          </button>
        </header>

        {result ? (
          <div
            role="status"
            data-testid="admin-bulk-drawer-result"
            className={`rounded-md border px-3 py-2 text-sm ${
              result.requiresFourEye
                ? 'border-destructive/40 bg-destructive/10 text-destructive'
                : 'border-success/40 bg-success/10 text-success'
            }`}
          >
            <strong>
              {result.status === 'applied'
                ? pickByLocale(locale, { en: 'Applied', sw: 'Imetekelezwa' })
                : pickByLocale(locale, {
                    en: 'Pending 2nd-eye',
                    sw: 'Inasubiri jicho la pili',
                  })}
              .
            </strong>{' '}
            {pickByLocale(locale, {
              en: `${result.processed} processed · ${result.failed} failed.`,
              sw: `${result.processed} zimechakatwa · ${result.failed} zimeshindwa.`,
            })}
            {result.requiresFourEye ? (
              <p className="mt-1 text-tiny">
                {pickByLocale(locale, {
                  en: 'A second admin must approve before this action takes effect.',
                  sw: 'Msimamizi wa pili lazima aidhinishe kabla kitendo hiki hakijaanza kufanya kazi.',
                })}
              </p>
            ) : null}
          </div>
        ) : null}

        <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
          <label className="block">
            <span className="text-xs text-neutral-400">
              {pickByLocale(locale, { en: 'Entity type', sw: 'Aina ya huluki' })}
            </span>
            <select
              value={entityType}
              onChange={(e) =>
                setEntityType(
                  e.target.value as (typeof ADMIN_BULK_ENTITY_TYPES)[number],
                )
              }
              className="mt-1 block w-full rounded border border-border bg-surface-sunken px-2 py-1.5 text-sm text-foreground"
              data-testid="admin-bulk-drawer-entity-type"
            >
              {ADMIN_BULK_ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-neutral-400">
              {pickByLocale(locale, { en: 'Action', sw: 'Kitendo' })}
            </span>
            <select
              value={action}
              onChange={(e) =>
                setAction(e.target.value as (typeof ADMIN_BULK_ACTIONS)[number])
              }
              className="mt-1 block w-full rounded border border-border bg-surface-sunken px-2 py-1.5 text-sm text-foreground"
              data-testid="admin-bulk-drawer-action"
            >
              {ADMIN_BULK_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            {isHighImpact ? (
              <span
                data-testid="admin-bulk-drawer-high-impact-badge"
                className="mt-1 inline-block rounded bg-destructive/10 px-1.5 py-0.5 text-tiny text-destructive"
              >
                {pickByLocale(locale, {
                  en: 'HIGH-impact · 4-eye approval required',
                  sw: 'Athari-KUBWA · idhini ya macho-4 inahitajika',
                })}
              </span>
            ) : null}
          </label>

          <label className="block">
            <span className="text-xs text-neutral-400">
              {pickByLocale(locale, {
                en: 'Entity ids (comma or space separated, max 100)',
                sw: 'Vitambulisho vya huluki (vimetenganishwa kwa koma au nafasi, max 100)',
              })}
            </span>
            <textarea
              value={idsRaw}
              onChange={(e) => setIdsRaw(e.target.value)}
              rows={4}
              className="mt-1 block w-full resize-none rounded border border-border bg-surface-sunken px-2 py-1.5 font-mono text-xs text-foreground"
              data-testid="admin-bulk-drawer-ids"
            />
          </label>

          <label className="block">
            <span className="text-xs text-neutral-400">
              {pickByLocale(locale, {
                en: 'Reason (min 8 chars, captured in audit chain)',
                sw: 'Sababu (chini 8 herufi, hunaswa katika mnyororo wa ukaguzi)',
              })}
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="mt-1 block w-full resize-none rounded border border-border bg-surface-sunken px-2 py-1.5 text-sm text-foreground"
              data-testid="admin-bulk-drawer-reason"
            />
          </label>

          {error ? (
            <p
              role="alert"
              data-testid="admin-bulk-drawer-error"
              className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-tiny text-destructive"
            >
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            loading={submitting}
            fullWidth
            data-testid="admin-bulk-drawer-submit"
          >
            {submitting
              ? pickByLocale(locale, {
                  en: 'Dispatching…',
                  sw: 'Inatuma…',
                })
              : pickByLocale(locale, {
                  en: 'Dispatch bulk action',
                  sw: 'Tuma kitendo cha wingi',
                })}
          </Button>
        </form>
      </aside>
    </div>
  );
}
