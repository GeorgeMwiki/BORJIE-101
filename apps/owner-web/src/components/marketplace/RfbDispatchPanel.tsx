'use client';

/**
 * Commercial chain L3 — owner→manager RFB dispatch UI.
 *
 * Renders site + manager pickers (sourced from /api/v1/mining/sites
 * — each site row exposes `managerUserId` so picking a site implies
 * the manager). Fires `useDispatchRfbToManager` on submit, displaying
 * a success toast + routing back to /marketplace.
 *
 * Bilingual sw/en per CLAUDE.md "Swahili-first".
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2, Send } from 'lucide-react';
import { useSitesList } from '@/lib/queries/sites';
import {
  useDispatchRfbToManager,
  type DispatchRfbResult,
} from '@/lib/queries/marketplace';
import { Toast } from '@/components/shared/Toast';
import { dataBStrings as S } from '@/i18n/strings/data-b';

interface RfbDispatchPanelProps {
  readonly rfbId: string;
  readonly locale?: 'sw' | 'en';
}

export function RfbDispatchPanel({
  rfbId,
  locale = 'en',
}: RfbDispatchPanelProps): JSX.Element {
  const isSw = locale === 'sw';
  const router = useRouter();
  const sitesQuery = useSitesList();
  const dispatch = useDispatchRfbToManager();
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [dueAt, setDueAt] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<DispatchRfbResult | null>(null);

  const sites = sitesQuery.data ?? [];
  // Surface only sites with a managerUserId — the dispatch endpoint
  // requires both fields. Filtering here keeps the UI honest.
  const dispatchableSites = useMemo(
    () => sites.filter((s) => Boolean(s.managerUserId)),
    [sites],
  );

  const selectedSite = useMemo(
    () => dispatchableSites.find((s) => s.id === selectedSiteId),
    [dispatchableSites, selectedSiteId],
  );

  const canSubmit =
    !!selectedSiteId &&
    !!selectedSite?.managerUserId &&
    !dispatch.isPending;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!selectedSite?.managerUserId) {
      setErrorMsg(isSw ? S.rfbNoManager.sw : S.rfbNoManager.en);
      return;
    }
    try {
      const result = await dispatch.mutateAsync({
        rfbId,
        managerId: selectedSite.managerUserId,
        siteId: selectedSite.id,
        ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
      });
      setToast(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Dispatch failed';
      setErrorMsg(msg);
    }
  }

  if (sitesQuery.isPending) {
    return (
      <div className="rounded-2xl border border-border bg-surface/40 p-6">
        <p className="text-sm text-neutral-400">
          {isSw ? S.rfbLoadingSites.sw : S.rfbLoadingSites.en}
        </p>
      </div>
    );
  }

  if (sitesQuery.isError) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
        {isSw ? S.rfbSitesError.sw : S.rfbSitesError.en}
      </div>
    );
  }

  if (dispatchableSites.length === 0) {
    return (
      <div className="rounded-2xl border border-warning/40 bg-warning/5 p-6 text-sm text-warning">
        {isSw ? S.rfbNoDispatchable.sw : S.rfbNoDispatchable.en}
      </div>
    );
  }

  return (
    <>
      <form
        onSubmit={onSubmit}
        className="space-y-6 rounded-2xl border border-border bg-surface/40 p-6"
      >
        <div className="space-y-2">
          <label
            htmlFor="rfb-dispatch-site"
            className="block text-sm font-medium text-foreground"
          >
            {isSw ? S.rfbPickSite.sw : S.rfbPickSite.en}
          </label>
          <select
            id="rfb-dispatch-site"
            value={selectedSiteId}
            onChange={(e) => setSelectedSiteId(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-signal-500 focus:outline-none focus:ring-1 focus:ring-signal-500"
          >
            <option value="">
              {isSw ? S.rfbSelectSiteOption.sw : S.rfbSelectSiteOption.en}
            </option>
            {dispatchableSites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-neutral-500">
            {isSw ? S.rfbManagerHint.sw : S.rfbManagerHint.en}
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="rfb-dispatch-due"
            className="block text-sm font-medium text-foreground"
          >
            {isSw ? S.rfbDueLabel.sw : S.rfbDueLabel.en}
          </label>
          <input
            id="rfb-dispatch-due"
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-signal-500 focus:outline-none focus:ring-1 focus:ring-signal-500"
          />
        </div>

        {selectedSite ? (
          <div className="rounded-md border border-border bg-background/40 p-3 text-xs text-neutral-400">
            <div>
              <span className="font-medium text-foreground">
                {isSw ? S.rfbSiteLabel.sw : S.rfbSiteLabel.en}
              </span>{' '}
              {selectedSite.name}
            </div>
            <div className="mt-0.5">
              <span className="font-medium text-foreground">
                {isSw ? S.rfbManagerLabel.sw : S.rfbManagerLabel.en}
              </span>{' '}
              <span className="font-mono">{selectedSite.managerUserId}</span>
            </div>
          </div>
        ) : null}

        {errorMsg ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            {errorMsg}
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-4 py-2 text-sm font-semibold text-background hover:bg-signal-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            {dispatch.isPending
              ? isSw
                ? S.rfbDispatching.sw
                : S.rfbDispatching.en
              : isSw
                ? S.rfbDispatch.sw
                : S.rfbDispatch.en}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => router.push('/marketplace')}
            className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface"
          >
            {isSw ? S.rfbCancel.sw : S.rfbCancel.en}
          </button>
        </div>
      </form>
      {toast ? (
        <Toast
          message={`${isSw ? S.rfbToast.sw : S.rfbToast.en} ${toast.taskId}`}
          onDismiss={() => {
            setToast(null);
            router.push('/marketplace');
          }}
        />
      ) : null}
    </>
  );
}
