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
import {
  Button,
  Skeleton,
  Alert,
  Input,
  FormField,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@borjie/design-system';
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
      <Skeleton
        className="h-40 rounded-2xl border border-border"
        aria-label={isSw ? S.rfbLoadingSites.sw : S.rfbLoadingSites.en}
      />
    );
  }

  if (sitesQuery.isError) {
    return (
      <Alert variant="error">
        {isSw ? S.rfbSitesError.sw : S.rfbSitesError.en}
      </Alert>
    );
  }

  if (dispatchableSites.length === 0) {
    return (
      <Alert variant="warning">
        {isSw ? S.rfbNoDispatchable.sw : S.rfbNoDispatchable.en}
      </Alert>
    );
  }

  return (
    <>
      <form
        onSubmit={onSubmit}
        className="space-y-6 rounded-2xl border border-border bg-surface/40 p-6"
      >
        <FormField label={isSw ? S.rfbPickSite.sw : S.rfbPickSite.en}>
          <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
            <SelectTrigger id="rfb-dispatch-site">
              <SelectValue
                placeholder={
                  isSw ? S.rfbSelectSiteOption.sw : S.rfbSelectSiteOption.en
                }
              />
            </SelectTrigger>
            <SelectContent>
              {dispatchableSites.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">
            {isSw ? S.rfbManagerHint.sw : S.rfbManagerHint.en}
          </p>
        </FormField>

        <FormField label={isSw ? S.rfbDueLabel.sw : S.rfbDueLabel.en}>
          <Input
            id="rfb-dispatch-due"
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
          />
        </FormField>

        {selectedSite ? (
          <div className="rounded-md border border-border bg-background/40 p-3 text-xs text-muted-foreground">
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
          <Alert variant="error" size="sm">
            {errorMsg}
          </Alert>
        ) : null}

        <div className="flex items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            disabled={!canSubmit}
            className="gap-2"
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
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push('/marketplace')}
            className="gap-2"
          >
            {isSw ? S.rfbCancel.sw : S.rfbCancel.en}
          </Button>
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
