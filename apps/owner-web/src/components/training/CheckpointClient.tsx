'use client';

/**
 * <CheckpointClient> — the mastery-checkpoint island (gap 10).
 *
 * Fetches a checkpoint built SERVER-SIDE from the mining concept catalog and
 * ordered weakest-concept-first (inverse-BKT) via the gateway
 * /api/v1/scenarios/checkpoint route. The 0.7 pass threshold (returned by the
 * gateway) gates the next phase. An optional `?kind=<scenarioKind>` scopes the
 * checkpoint to one phase's concepts.
 *
 * HONEST-DEGRADE: questions are deterministic and never fabricated. A 503
 * (thrown) shows a graceful "service unavailable"; a 200 with `degraded: true`
 * (no catalog concept resolved) renders the checkpoint's empty state.
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ServerCrash } from 'lucide-react';
import type {
  CheckpointQuestion,
  ScenarioLanguage,
} from '@borjie/api-client/training-types';
import { trainingT } from '@/i18n/strings/training';
import { fetchCheckpoint, TrainingGatewayError } from './training-gateway';
import { MasteryCheckpoint } from './MasteryCheckpoint';
import { TrainingNav } from './TrainingNav';

interface CheckpointClientProps {
  readonly locale: ScenarioLanguage;
}

export function CheckpointClient({ locale }: CheckpointClientProps) {
  return (
    <Suspense fallback={null}>
      <CheckpointClientInner locale={locale} />
    </Suspense>
  );
}

function CheckpointClientInner({ locale }: CheckpointClientProps) {
  const tr = trainingT(locale);
  const router = useRouter();
  const searchParams = useSearchParams();
  const kind = searchParams?.get('kind') ?? undefined;

  const [questions, setQuestions] = useState<readonly CheckpointQuestion[]>([]);
  const [passThreshold, setPassThreshold] = useState(0.7);
  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorStatus(null);
    try {
      const data = await fetchCheckpoint(locale, kind);
      setQuestions(data.questions);
      setPassThreshold(data.passThreshold ?? 0.7);
    } catch (err) {
      const status = err instanceof TrainingGatewayError ? err.status : 0;
      setErrorStatus(status);
    } finally {
      setLoading(false);
    }
  }, [locale, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const goToHub = () => router.push('/training/scenarios');

  return (
    <div className="space-y-5">
      <TrainingNav locale={locale} />

      {loading ? <CheckpointSkeleton /> : null}

      {!loading && errorStatus !== null ? (
        <div className="flex items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          <ServerCrash className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span>{errorStatus === 503 ? tr.t('errorUnavailable') : tr.t('errorLoad')}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="ml-auto rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-foreground hover:bg-surface/60"
          >
            {tr.t('retry')}
          </button>
        </div>
      ) : null}

      {!loading && errorStatus === null ? (
        <MasteryCheckpoint
          questions={questions}
          passThreshold={passThreshold}
          locale={locale}
          onExit={goToHub}
        />
      ) : null}
    </div>
  );
}

function CheckpointSkeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-5" aria-busy="true">
      <div className="h-16 w-full animate-pulse rounded-2xl bg-surface/40" />
      <div className="h-64 w-full animate-pulse rounded-2xl bg-surface/40" />
    </div>
  );
}
