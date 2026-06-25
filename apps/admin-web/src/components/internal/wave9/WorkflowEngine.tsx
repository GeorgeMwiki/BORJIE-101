'use client';

import { Skeleton, Alert } from '@borjie/design-system';
import { StubBadge } from '../StubBadge';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { localizeApiError } from '@borjie/error-catalog';
import { localizeEnumLabel, FLOW_POSTURE_LABELS } from '@/lib/internal/enum-labels';
import {
  useMyWorkflowQueue,
  useFlowAutonomy,
} from '@/lib/internal/wave9/queries';

/**
 * Workflow engine & flow autonomy (I-W-26, read-first).
 *
 * Three read panels over the persistent four-eyes workflow engine:
 *   1. My queue          — the caller's open runs.
 *   2. Flow postures      — each flow's auto|gated decision.
 *   3. Pending postures   — flows awaiting the creation-time auto-vs-gated
 *                           confirmation.
 *
 * Starting / approving runs and flipping a posture are state-changing and
 * stay a follow-up that rides the durable-saga wave; the inviolable rails
 * still gate every action regardless of posture.
 */
const S = {
  myRuns: { en: 'My open runs', sw: 'Mizunguko yangu iliyo wazi' },
  readFirst: { en: 'read-first', sw: 'soma-kwanza' },
  loadingQueue: { en: 'Loading your queue…', sw: 'Inapakia foleni yako…' },
  noRuns: { en: 'No open workflow runs.', sw: 'Hakuna mizunguko ya kazi iliyo wazi.' },
  postures: { en: 'Flow postures', sw: 'Misimamo ya mtiririko' },
  loadingPostures: { en: 'Loading flow postures…', sw: 'Inapakia misimamo ya mtiririko…' },
  noPostures: {
    en: 'No flow postures set — every flow is GATED by default.',
    sw: 'Hakuna misimamo ya mtiririko iliyowekwa — kila mtiririko umeZUIWA kwa chaguo-msingi.',
  },
  ceiling: { en: 'ceiling', sw: 'kikomo' },
  pendingTitle: {
    en: 'Pending auto-vs-gated confirmations',
    sw: 'Uthibitisho wa otomatiki-dhidi-ya-kuzuiwa unaosubiri',
  },
  trustCalibration: { en: 'trust-calibration', sw: 'urekebishaji-imani' },
  loadingPending: { en: 'Loading pending confirmations…', sw: 'Inapakia uthibitisho unaosubiri…' },
  noPending: { en: 'No flows awaiting confirmation.', sw: 'Hakuna mitiririko inayosubiri uthibitisho.' },
} as const;

export function WorkflowEngine({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const queue = useMyWorkflowQueue();
  const postures = useFlowAutonomy(false);
  const pending = useFlowAutonomy(true);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">{pickByLocale(locale, S.myRuns)}</h2>
          <StubBadge tone="info">{pickByLocale(locale, S.readFirst)}</StubBadge>
        </div>
        {queue.isPending ? (
          <Skeleton className="h-24 w-full rounded-lg" aria-label={pickByLocale(locale, S.loadingQueue)} />
        ) : queue.isError ? (
          <Alert variant="error">{localizeApiError(queue.error, locale)}</Alert>
        ) : (queue.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{pickByLocale(locale, S.noRuns)}</p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border bg-surface">
            {(queue.data ?? []).map((run) => (
              <article key={run.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-muted-foreground">{run.id}</p>
                  {run.definitionId ? (
                    <p className="text-sm text-foreground">{run.definitionId}</p>
                  ) : null}
                  {run.scope ? (
                    <p className="text-xs text-muted-foreground">
                      {run.scope}
                      {run.scopeRef ? ` · ${run.scopeRef}` : ''}
                    </p>
                  ) : null}
                </div>
                {run.state || run.status ? (
                  <StubBadge tone="neutral">{run.state ?? run.status}</StubBadge>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">{pickByLocale(locale, S.postures)}</h2>
        {postures.isPending ? (
          <Skeleton className="h-24 w-full rounded-lg" aria-label={pickByLocale(locale, S.loadingPostures)} />
        ) : postures.isError ? (
          <Alert variant="error">{localizeApiError(postures.error, locale)}</Alert>
        ) : (postures.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{pickByLocale(locale, S.noPostures)}</p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border bg-surface">
            {(postures.data ?? []).map((pref) => (
              <article key={pref.flowId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-muted-foreground">{pref.flowId}</p>
                  {pref.riskCeiling ? (
                    <p className="text-xs text-muted-foreground">
                      {pickByLocale(locale, S.ceiling)}: {pref.riskCeiling}
                    </p>
                  ) : null}
                </div>
                <StubBadge tone={pref.posture === 'auto' ? 'success' : 'warn'}>
                  {localizeEnumLabel(FLOW_POSTURE_LABELS, pref.posture, locale)}
                </StubBadge>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">{pickByLocale(locale, S.pendingTitle)}</h2>
          <StubBadge tone="warn">{pickByLocale(locale, S.trustCalibration)}</StubBadge>
        </div>
        {pending.isPending ? (
          <Skeleton className="h-24 w-full rounded-lg" aria-label={pickByLocale(locale, S.loadingPending)} />
        ) : pending.isError ? (
          <Alert variant="error">{localizeApiError(pending.error, locale)}</Alert>
        ) : (pending.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{pickByLocale(locale, S.noPending)}</p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border bg-surface">
            {(pending.data ?? []).map((pref) => (
              <article key={pref.flowId} className="flex items-center justify-between gap-3 px-4 py-3">
                <p className="font-mono text-xs text-muted-foreground">{pref.flowId}</p>
                <StubBadge tone="neutral">
                  {localizeEnumLabel(FLOW_POSTURE_LABELS, pref.posture, locale)}
                </StubBadge>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
