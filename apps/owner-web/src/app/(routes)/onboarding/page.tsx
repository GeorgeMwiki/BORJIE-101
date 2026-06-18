'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { Button } from '@borjie/design-system';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionCard } from '@/components/shared/SectionCard';
import { Stepper, type StepperStep } from '@/components/onboarding/Stepper';
import {
  KybStep,
  FileUploadStep,
  CockpitSeedStep,
  kybSchema,
  type KybFormValues,
} from '@/components/onboarding/steps';
import {
  OnboardingDone,
  type CockpitSeedSummary,
} from '@/components/onboarding/OnboardingDone';
import {
  useAdvanceOnboarding,
  useCompleteOnboarding,
  useStartOnboarding,
  type OnboardingStep,
} from '@/lib/queries/onboarding';
import {
  ingestOnboardingFiles,
  commitOnboardingEntities,
  type IngestedFile,
  type CommitTally,
} from '@/lib/queries/onboarding-ingest';
import { pickByLocale, useLocale } from '@/lib/locale';
import { routesAStrings as S } from '@/i18n/strings/routes-a';

const STEPS: ReadonlyArray<StepperStep> = [
  { id: 'kyb', label: 'NIDA + KYB', labelSw: 'NIDA + KYB' },
  {
    id: 'licences',
    label: 'Licence import',
    labelSw: S.onboarding.stepLicencesSw.sw,
  },
  {
    id: 'sites',
    label: 'Site geometry',
    labelSw: S.onboarding.stepSitesSw.sw,
  },
  {
    id: 'drill_holes',
    label: 'Drill-hole batch',
    labelSw: S.onboarding.stepDrillHolesSw.sw,
  },
  {
    id: 'cockpit_seed',
    label: 'Cockpit seed',
    labelSw: S.onboarding.stepCockpitSeedSw.sw,
  },
];

const STEP_KIND: ReadonlyArray<OnboardingStep> = [
  'kyb',
  'licences',
  'sites',
  'drill_holes',
  'cockpit_seed',
];

/** A picked licence file paired with its real upload→OCR result. */
interface LicenceUpload {
  readonly file: File;
  readonly ingested: IngestedFile;
}

/** Map a typed ingest reason key → its bilingual string pair. */
function reasonStrings(
  key: Extract<IngestedFile, { ok: false }>['reasonKey'],
): { readonly en: string; readonly sw: string } {
  switch (key) {
    case 'reasonMimeNotAllowed':
      return S.onboarding.reasonMimeNotAllowed;
    case 'reasonTooLarge':
      return S.onboarding.reasonTooLarge;
    case 'reasonStorageUnavailable':
      return S.onboarding.reasonStorageUnavailable;
    case 'reasonStoragePutFailed':
      return S.onboarding.reasonStoragePutFailed;
    case 'reasonReadyFailed':
      return S.onboarding.reasonReadyFailed;
    default:
      return S.onboarding.reasonUnknown;
  }
}

/**
 * O-W-21 — Owner onboarding wizard (LANE B1 — real-row bridge).
 *
 * Five steps, server-persisted via the orchestrator (start / advance /
 * complete). The LICENCE step now pushes the picked PDFs' BYTES through the
 * real document-intelligence upload → OCR loop, captures an `ocr_extraction_id`
 * per file, and on finish calls the recipe `/onboarding/commit` so REAL,
 * idempotent, RLS-scoped, audit-chained `licences` rows land in the cockpit.
 * The wizard then renders a confirmation surface (created-row tallies +
 * cockpit seed) instead of redirecting to a generic `/`.
 *
 * Honesty: site (GeoJSON) + drill (CSV) steps are not document mimes, so they
 * cannot ride the OCR bridge — they record refs only, exactly as before.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const locale = useLocale();
  const [step, setStep] = useState<number>(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [licenceUploads, setLicenceUploads] = useState<ReadonlyArray<LicenceUpload>>([]);
  const [licenceUploading, setLicenceUploading] = useState<boolean>(false);
  const [siteFiles, setSiteFiles] = useState<ReadonlyArray<File>>([]);
  const [drillFiles, setDrillFiles] = useState<ReadonlyArray<File>>([]);
  const [headline, setHeadline] = useState<string>('');
  const [stepError, setStepError] = useState<string | null>(null);

  // Confirmation surface state — set once the run completes + rows commit.
  const [done, setDone] = useState<boolean>(false);
  const [tallies, setTallies] = useState<ReadonlyArray<CommitTally>>([]);
  const [seed, setSeed] = useState<CockpitSeedSummary | null>(null);
  const [committing, setCommitting] = useState<boolean>(false);
  const [pendingExtraction, setPendingExtraction] = useState<boolean>(false);

  const kybForm = useForm<KybFormValues>({ resolver: zodResolver(kybSchema) });

  const startMutation = useStartOnboarding();
  const advanceMutation = useAdvanceOnboarding();
  const completeMutation = useCompleteOnboarding();

  useEffect(() => {
    if (sessionId || startMutation.isPending || startMutation.isError) return;
    startMutation.mutate(undefined, {
      onSuccess: (data) => setSessionId(data.sessionId),
    });
  }, [sessionId, startMutation]);

  const retryStart = useCallback((): void => {
    startMutation.reset();
  }, [startMutation]);

  // When licence files are picked, upload their BYTES immediately so the OCR
  // worker can start; we capture each file's ocr_extraction_id for commit.
  const onLicenceFiles = useCallback(
    async (next: ReadonlyArray<File>): Promise<void> => {
      const known = new Set(licenceUploads.map((u) => `${u.file.name}:${u.file.size}`));
      const fresh = next.filter((f) => !known.has(`${f.name}:${f.size}`));
      if (fresh.length === 0) return;
      setLicenceUploading(true);
      setStepError(null);
      try {
        const ingested = await ingestOnboardingFiles(fresh);
        setLicenceUploads((current) => {
          // Re-dedupe against the FRESHEST state so a rapid second pick that
          // raced this one cannot append the same licence twice.
          const knownNow = new Set(
            current.map((u) => `${u.file.name}:${u.file.size}`),
          );
          const toAdd = fresh
            .map((file, i) => ({ file, ingested: ingested[i]! }))
            .filter((u) => !knownNow.has(`${u.file.name}:${u.file.size}`));
          return [...current, ...toAdd];
        });
      } finally {
        setLicenceUploading(false);
      }
    },
    [licenceUploads],
  );

  const buildPayload = useCallback(
    (index: number): unknown | null => {
      if (index === 0) {
        const values = kybForm.getValues();
        return {
          companyName: values.companyName,
          registrationNo: values.registrationNo,
          tin: values.tin,
          registeredAddress: values.registeredAddress,
          directors: [
            { fullName: values.directorFullName, nidaId: values.directorNidaId, role: 'director' },
          ],
        };
      }
      // Licence refs now carry the real documentId + ocrExtractionId captured
      // at upload time, so the orchestrator persists more than a bare name.
      if (index === 1) {
        return {
          licences: licenceUploads.map((u) => ({
            name: u.file.name,
            ...(u.ingested.ok && u.ingested.documentId
              ? { documentId: u.ingested.documentId }
              : {}),
            ...(u.ingested.ok && u.ingested.ocrExtractionId
              ? { ocrExtractionId: u.ingested.ocrExtractionId }
              : {}),
          })),
        };
      }
      if (index === 2) return { sites: siteFiles.map((file) => ({ name: file.name })) };
      if (index === 3) return { rows: drillFiles.map((file) => ({ name: file.name })) };
      if (index === 4) return { headline };
      return null;
    },
    [drillFiles, headline, kybForm, licenceUploads, siteFiles],
  );

  const validateStep = useCallback(
    async (index: number): Promise<boolean> => {
      if (index === 0) return kybForm.trigger();
      if (index === 1) return licenceUploads.length > 0 && !licenceUploading;
      if (index === 2) return siteFiles.length > 0;
      if (index === 3) return drillFiles.length > 0;
      return true;
    },
    [drillFiles.length, kybForm, licenceUploads.length, licenceUploading, siteFiles.length],
  );

  // Commit every captured licence extraction into real `licences` rows, then
  // build the confirmation summary from the tallies + the server cockpit seed.
  const finishRun = useCallback(
    async (currentSessionId: string): Promise<void> => {
      setCommitting(true);
      try {
        const completeResult = await completeMutation.mutateAsync(currentSessionId);
        const extractionIds = licenceUploads
          .map((u) => (u.ingested.ok ? u.ingested.ocrExtractionId : null))
          .filter((id): id is string => Boolean(id));
        const hasPending =
          licenceUploads.some((u) => u.ingested.ok && !u.ingested.ocrExtractionId);

        const licenceTally =
          extractionIds.length > 0
            ? await commitOnboardingEntities({ extractionIds, entityType: 'licence' })
            : null;

        const cs = completeResult.cockpitSeed ?? {};
        setTallies(licenceTally ? [licenceTally] : []);
        setSeed({
          headline: cs.headline ?? headline,
          licencesRefs: cs.licencesRefs ?? licenceUploads.length,
          sitesRefs: cs.sitesRefs ?? siteFiles.length,
          drillRefs: cs.drillRefs ?? drillFiles.length,
          kybCaptured: cs.kybCaptured ?? true,
        });
        setPendingExtraction(hasPending);
        setDone(true);
      } finally {
        setCommitting(false);
      }
    },
    [completeMutation, drillFiles.length, headline, licenceUploads, siteFiles.length],
  );

  const goNext = useCallback(async (): Promise<void> => {
    setStepError(null);
    const valid = await validateStep(step);
    if (!valid) {
      setStepError(pickByLocale(locale, S.onboarding.completeStepFirst));
      return;
    }
    if (!sessionId) {
      setStepError(pickByLocale(locale, S.onboarding.sessionNotReady));
      return;
    }
    const payload = buildPayload(step);
    if (payload === null) return;
    try {
      await advanceMutation.mutateAsync({ sessionId, step: STEP_KIND[step]!, payload });
      if (step === STEPS.length - 1) {
        await finishRun(sessionId);
        return;
      }
      setStep((current) => current + 1);
    } catch (error) {
      setStepError((error as Error)?.message ?? pickByLocale(locale, S.onboarding.reasonUnknown));
    }
  }, [advanceMutation, buildPayload, finishRun, locale, sessionId, step, validateStep]);

  const goBack = useCallback((): void => {
    setStepError(null);
    setStep((current) => Math.max(current - 1, 0));
  }, []);

  const goToCockpit = useCallback((): void => {
    router.push('/');
  }, [router]);

  if (done) {
    return (
      <>
        <ScreenHeader slug="onboarding" />
        <OnboardingDone
          tallies={tallies}
          seed={seed}
          hasPendingExtraction={pendingExtraction}
          onGoToCockpit={goToCockpit}
        />
      </>
    );
  }

  const isFinal = step === STEPS.length - 1;
  const submitting =
    advanceMutation.isPending || completeMutation.isPending || committing || licenceUploading;

  return (
    <>
      <ScreenHeader slug="onboarding" />
      <div className="space-y-4 px-8 py-6">
        <SectionCard title="Progress" subtitle={S.onboarding.progressSubtitle.both}>
          <Stepper steps={STEPS} current={step} />
        </SectionCard>
        {startMutation.isError && !sessionId ? (
          <div
            role="alert"
            data-testid="onboarding-start-error"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-4"
          >
            <p className="text-sm font-semibold text-destructive">
              {pickByLocale(locale, S.onboarding.startFailedTitle)}
            </p>
            <p className="mt-1 text-xs text-neutral-300">
              {pickByLocale(locale, S.onboarding.startFailedBody)}
            </p>
            {startMutation.error instanceof Error ? (
              <p className="mt-1 text-xs text-neutral-500">{startMutation.error.message}</p>
            ) : null}
            <button
              type="button"
              onClick={retryStart}
              className="mt-3 inline-flex items-center gap-2 rounded-md border border-destructive/50 bg-background px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10"
            >
              {pickByLocale(locale, S.onboarding.retryButton)}
            </button>
          </div>
        ) : null}
        <SectionCard
          title={`Step ${step + 1} of ${STEPS.length}`}
          subtitle={`${STEPS[step]!.label} / ${STEPS[step]!.labelSw}`}
        >
          {step === 0 ? <KybStep form={kybForm} /> : null}
          {step === 1 ? (
            <FileUploadStep
              accept=".pdf"
              hintEn="Drop PML/PL/SML/ML PDFs here"
              hintSw={S.onboarding.hintLicencesSw.sw}
              files={licenceUploads.map((u) => u.file)}
              onChange={(files) => void onLicenceFiles(files)}
            />
          ) : null}
          {step === 1 && licenceUploading ? (
            <p className="mt-2 inline-flex items-center gap-2 text-xs text-neutral-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {pickByLocale(locale, S.onboarding.uploadingLicences)}
            </p>
          ) : null}
          {step === 1 && licenceUploads.some((u) => !u.ingested.ok) ? (
            <div className="mt-2 rounded-md border border-warning/40 bg-warning-subtle/10 p-2">
              <p className="text-xs font-semibold text-warning">
                {pickByLocale(locale, S.onboarding.uploadFailedTitle)}
              </p>
              <ul className="mt-1 space-y-0.5 text-tiny text-neutral-400">
                {licenceUploads
                  .filter((u) => !u.ingested.ok)
                  .map((u, idx) =>
                    u.ingested.ok ? null : (
                      <li key={`${u.file.name}-${idx}`}>
                        {u.file.name} — {pickByLocale(locale, reasonStrings(u.ingested.reasonKey))}
                      </li>
                    ),
                  )}
              </ul>
            </div>
          ) : null}
          {step === 2 ? (
            <FileUploadStep
              accept=".geojson,.json"
              hintEn="Drop a GeoJSON polygon for each site"
              hintSw={S.onboarding.hintSitesSw.sw}
              files={siteFiles}
              onChange={setSiteFiles}
            />
          ) : null}
          {step === 3 ? (
            <FileUploadStep
              accept=".csv"
              hintEn="Drop the first drill-hole CSV batch"
              hintSw={S.onboarding.hintDrillSw.sw}
              files={drillFiles}
              onChange={setDrillFiles}
            />
          ) : null}
          {step === 4 ? <CockpitSeedStep headline={headline} onChange={setHeadline} /> : null}
          {stepError ? <p className="mt-3 text-xs text-destructive">{stepError}</p> : null}
          <div className="mt-4 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={goBack}
              disabled={step === 0 || submitting}
            >
              {S.onboarding.backButton.both}
            </Button>
            <button
              type="button"
              onClick={() => void goNext()}
              disabled={submitting || !sessionId}
              className="inline-flex items-center gap-2 rounded-md border border-warning bg-warning-subtle/30 px-3 py-1.5 text-xs text-warning hover:bg-warning-subtle/50 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {isFinal ? S.onboarding.finishButton.both : S.onboarding.nextButton.both}
            </button>
          </div>
        </SectionCard>
      </div>
    </>
  );
}
