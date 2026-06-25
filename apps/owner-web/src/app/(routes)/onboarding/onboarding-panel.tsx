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
  commitOnboardingSample,
  geoJsonToSites,
  csvToDrillHoles,
  type IngestedFile,
  type CommitTally,
  type CommitEntityType,
  type TabularSample,
} from '@/lib/queries/onboarding-ingest';
import { localizeError } from '@/lib/api-client';
import { pickByLocale, useLocale, type Locale } from '@/lib/locale';
import { routesAStrings as S } from '@/i18n/strings/routes-a';
import { onboardingStepsStrings as OS } from '@/i18n/strings/onboarding-steps';

/**
 * Step metadata, each label a strict `{ en, sw }` pair. The Stepper + the
 * "Step X of Y" subtitle resolve ONE side via `pickByLocale(locale, …)`, so
 * a single language paints — never the prior `${label} / ${labelSw}` mix.
 */
const STEP_META: ReadonlyArray<{
  readonly id: OnboardingStep;
  readonly label: { readonly en: string; readonly sw: string };
}> = [
  { id: 'kyb', label: OS.stepKyb },
  { id: 'licences', label: OS.stepLicences },
  { id: 'sites', label: OS.stepSites },
  { id: 'drill_holes', label: OS.stepDrillHoles },
  { id: 'cockpit_seed', label: OS.stepCockpitSeed },
];

const STEP_KIND: ReadonlyArray<OnboardingStep> = STEP_META.map((s) => s.id);
const STEP_COUNT = STEP_META.length;

/** A picked licence file paired with its real upload→OCR result. */
interface LicenceUpload {
  readonly file: File;
  readonly ingested: IngestedFile;
}

/** A picked tabular file (GeoJSON site / CSV drill) parsed client-side. */
interface ParsedTabularFile {
  readonly fileName: string;
  /** The parsed sample, or null when the bytes were not valid for the kind. */
  readonly sample: TabularSample | null;
}

/**
 * Read + parse picked tabular files into committable samples. GeoJSON feeds
 * become site rows; CSV feeds become drill-hole rows. Never throws — an
 * unreadable file resolves to `{ sample: null }` so the caller can surface an
 * honest localized note instead of silently dropping it.
 */
async function parseTabularFiles(
  files: ReadonlyArray<File>,
  kind: 'site' | 'drill_hole',
): Promise<ReadonlyArray<ParsedTabularFile>> {
  const out: ParsedTabularFile[] = [];
  for (const file of files) {
    let sample: TabularSample | null = null;
    try {
      const text = await file.text();
      sample =
        kind === 'site'
          ? geoJsonToSites(file.name, text)
          : csvToDrillHoles(file.name, text);
    } catch {
      sample = null;
    }
    out.push({ fileName: file.name, sample });
  }
  return out;
}

/** Commit every successfully-parsed sample for an entity, folding the tally. */
async function commitTabular(
  parsed: ReadonlyArray<ParsedTabularFile>,
  entityType: CommitEntityType,
): Promise<CommitTally | null> {
  const samples = parsed
    .map((p) => p.sample)
    .filter((s): s is TabularSample => s !== null);
  if (samples.length === 0) return null;
  let tally: CommitTally = {
    entityType,
    rowsInserted: 0,
    rowsUpdated: 0,
    rowsSkipped: 0,
  };
  for (const sample of samples) {
    const result = await commitOnboardingSample({ sample, entityType });
    if (result) {
      tally = {
        entityType,
        rowsInserted: tally.rowsInserted + result.rowsInserted,
        rowsUpdated: tally.rowsUpdated + result.rowsUpdated,
        rowsSkipped: tally.rowsSkipped + result.rowsSkipped,
      };
    }
  }
  return tally;
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
 * O-W-21 — Owner onboarding wizard (LANE B1 — real-row bridge, client island).
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
 *
 * Seeded with `initialLocale` from the server page so SSR + the first client
 * paint render the SAME language — never an EN title under an SW header for a
 * frame (the zero-mix canon).
 */
export function OnboardingPanel({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
}) {
  const router = useRouter();
  const locale = useLocale(initialLocale);
  const [step, setStep] = useState<number>(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [licenceUploads, setLicenceUploads] = useState<ReadonlyArray<LicenceUpload>>([]);
  const [licenceUploading, setLicenceUploading] = useState<boolean>(false);
  const [siteFiles, setSiteFiles] = useState<ReadonlyArray<File>>([]);
  const [drillFiles, setDrillFiles] = useState<ReadonlyArray<File>>([]);
  const [siteParsed, setSiteParsed] = useState<ReadonlyArray<ParsedTabularFile>>([]);
  const [drillParsed, setDrillParsed] = useState<ReadonlyArray<ParsedTabularFile>>([]);
  const [tabularParsing, setTabularParsing] = useState<boolean>(false);
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

  // Sites (GeoJSON) + drill holes (CSV) are not document mimes — they cannot
  // ride the OCR bridge. Parse their bytes CLIENT-SIDE on pick so unreadable
  // files surface an honest note immediately (never silently dropped), and so
  // finish can commit them as real `sites` / `drill_holes` rows.
  const onSiteFiles = useCallback(async (next: ReadonlyArray<File>): Promise<void> => {
    setStepError(null);
    setSiteFiles(next);
    setTabularParsing(true);
    try {
      setSiteParsed(await parseTabularFiles(next, 'site'));
    } finally {
      setTabularParsing(false);
    }
  }, []);

  const onDrillFiles = useCallback(async (next: ReadonlyArray<File>): Promise<void> => {
    setStepError(null);
    setDrillFiles(next);
    setTabularParsing(true);
    try {
      setDrillParsed(await parseTabularFiles(next, 'drill_hole'));
    } finally {
      setTabularParsing(false);
    }
  }, []);

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
      // KYB + licence remain REQUIRED — they are the legal spine the cockpit
      // cannot bootstrap without. NEVER make these optional.
      if (index === 0) return kybForm.trigger();
      if (index === 1) return licenceUploads.length > 0 && !licenceUploading;
      // NEVER-BLOCKED: the GeoJSON site (step 2) + drill CSV (step 3) imports
      // are OPTIONAL data bootstraps — a new owner may not have either file at
      // sign-up. So advancing with NO file picked is valid (true): the owner
      // can add sites/drill holes later. The ONLY block is a file that was
      // picked but could not be parsed — that we still gate so the owner fixes
      // or removes it rather than silently committing zero rows. We also never
      // advance mid-parse.
      if (index === 2)
        return (
          !tabularParsing &&
          (siteFiles.length === 0 || siteParsed.some((p) => p.sample !== null))
        );
      if (index === 3)
        return (
          !tabularParsing &&
          (drillFiles.length === 0 || drillParsed.some((p) => p.sample !== null))
        );
      return true;
    },
    [
      drillFiles.length,
      drillParsed,
      kybForm,
      licenceUploading,
      licenceUploads.length,
      siteFiles.length,
      siteParsed,
      tabularParsing,
    ],
  );

  // Commit every captured licence extraction into real `licences` rows AND
  // every parsed site/drill sample into real `sites` / `drill_holes` rows,
  // then build the confirmation summary from the tallies + the cockpit seed.
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
        const siteTally = await commitTabular(siteParsed, 'site');
        const drillTally = await commitTabular(drillParsed, 'drill_hole');

        const cs = completeResult.cockpitSeed ?? {};
        setTallies(
          [licenceTally, siteTally, drillTally].filter(
            (t): t is CommitTally => t !== null,
          ),
        );
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
    [
      completeMutation,
      drillFiles.length,
      drillParsed,
      headline,
      licenceUploads,
      siteFiles.length,
      siteParsed,
    ],
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
      if (step === STEP_COUNT - 1) {
        await finishRun(sessionId);
        return;
      }
      setStep((current) => current + 1);
    } catch (error) {
      // ZERO-MIX: never surface the raw gateway/dev `error.message` (English
      // wire copy) — localize through the catalog so the alert paints the
      // active locale only.
      setStepError(localizeError(error, locale));
    }
  }, [advanceMutation, buildPayload, finishRun, locale, sessionId, step, validateStep]);

  const goBack = useCallback((): void => {
    setStepError(null);
    setStep((current) => Math.max(current - 1, 0));
  }, []);

  /**
   * NEVER-BLOCKED skip for the OPTIONAL data-import steps (sites / drill).
   * Advances the orchestrator with an empty ref payload so the run still
   * records the step was reached, then moves on — no file required. KYB +
   * licence have no Skip and stay required.
   */
  const goSkip = useCallback(async (): Promise<void> => {
    setStepError(null);
    if (step !== 2 && step !== 3) return;
    if (!sessionId) {
      setStepError(pickByLocale(locale, S.onboarding.sessionNotReady));
      return;
    }
    const payload = step === 2 ? { sites: [] } : { rows: [] };
    try {
      await advanceMutation.mutateAsync({ sessionId, step: STEP_KIND[step]!, payload });
      setStep((current) => current + 1);
    } catch (error) {
      setStepError(localizeError(error, locale));
    }
  }, [advanceMutation, locale, sessionId, step]);

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

  // Resolve each step label to the ACTIVE locale only (no EN/SW mixing). The
  // Stepper + the "Step X of Y" subtitle read these single-language strings.
  const steps: ReadonlyArray<StepperStep> = STEP_META.map((meta) => ({
    id: meta.id,
    label: pickByLocale(locale, meta.label),
  }));
  const isFinal = step === STEP_COUNT - 1;
  // Steps 2 (site GeoJSON) + 3 (drill CSV) are OPTIONAL data imports — they
  // get a Skip control + an "optional" note so a new owner with no file is
  // never trapped. KYB (0) + licence (1) + cockpit seed (4) stay mandatory.
  const isOptionalStep = step === 2 || step === 3;
  const submitting =
    advanceMutation.isPending ||
    completeMutation.isPending ||
    committing ||
    licenceUploading ||
    tabularParsing;

  return (
    <>
      <ScreenHeader slug="onboarding" />
      <div className="space-y-4 px-8 py-6">
        <SectionCard title={pickByLocale(locale, OS.progressTitle)}>
          <Stepper steps={steps} current={step} />
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
            <p className="mt-1 text-xs text-muted-foreground">
              {pickByLocale(locale, S.onboarding.startFailedBody)}
            </p>
            {startMutation.error ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {localizeError(startMutation.error, locale)}
              </p>
            ) : null}
            <button
              type="button"
              onClick={retryStart}
              className="mt-3 inline-flex items-center gap-2 rounded-md border border-destructive/50 bg-background px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {pickByLocale(locale, S.onboarding.retryButton)}
            </button>
          </div>
        ) : null}
        <SectionCard
          title={pickByLocale(locale, OS.stepCounter)
            .replace('{{n}}', String(step + 1))
            .replace('{{total}}', String(STEP_COUNT))}
          subtitle={steps[step]!.label}
        >
          {step === 0 ? <KybStep form={kybForm} locale={locale} /> : null}
          {step === 1 ? (
            <FileUploadStep
              accept=".pdf"
              hint={pickByLocale(locale, OS.hintLicences)}
              locale={locale}
              files={licenceUploads.map((u) => u.file)}
              onChange={(files) => void onLicenceFiles(files)}
            />
          ) : null}
          {step === 1 && licenceUploading ? (
            <p className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {pickByLocale(locale, S.onboarding.uploadingLicences)}
            </p>
          ) : null}
          {step === 1 && licenceUploads.some((u) => !u.ingested.ok) ? (
            <div className="mt-2 rounded-md border border-warning/40 bg-warning-subtle/10 p-2">
              <p className="text-xs font-semibold text-warning">
                {pickByLocale(locale, S.onboarding.uploadFailedTitle)}
              </p>
              <ul className="mt-1 space-y-0.5 text-tiny text-muted-foreground">
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
              hint={pickByLocale(locale, OS.hintSites)}
              locale={locale}
              files={siteFiles}
              onChange={(files) => void onSiteFiles(files)}
            />
          ) : null}
          {step === 2 && siteParsed.some((p) => p.sample === null) ? (
            <div className="mt-2 rounded-md border border-warning/40 bg-warning-subtle/10 p-2">
              <p className="text-xs font-semibold text-warning">
                {pickByLocale(locale, OS.siteParseFailedTitle)}
              </p>
              <ul className="mt-1 space-y-0.5 text-tiny text-muted-foreground">
                {siteParsed
                  .filter((p) => p.sample === null)
                  .map((p, idx) => (
                    <li key={`${p.fileName}-${idx}`}>
                      {p.fileName} — {pickByLocale(locale, OS.reasonNotGeoJson)}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
          {step === 3 ? (
            <FileUploadStep
              accept=".csv"
              hint={pickByLocale(locale, OS.hintDrill)}
              locale={locale}
              files={drillFiles}
              onChange={(files) => void onDrillFiles(files)}
            />
          ) : null}
          {step === 3 && drillParsed.some((p) => p.sample === null) ? (
            <div className="mt-2 rounded-md border border-warning/40 bg-warning-subtle/10 p-2">
              <p className="text-xs font-semibold text-warning">
                {pickByLocale(locale, OS.drillParseFailedTitle)}
              </p>
              <ul className="mt-1 space-y-0.5 text-tiny text-muted-foreground">
                {drillParsed
                  .filter((p) => p.sample === null)
                  .map((p, idx) => (
                    <li key={`${p.fileName}-${idx}`}>
                      {p.fileName} — {pickByLocale(locale, OS.reasonNotCsv)}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
          {step === 4 ? (
            <CockpitSeedStep headline={headline} locale={locale} onChange={setHeadline} />
          ) : null}
          {isOptionalStep ? (
            <p className="mt-3 text-tiny text-muted-foreground">
              {pickByLocale(locale, OS.stepOptionalNote)}
            </p>
          ) : null}
          {stepError ? <p className="mt-3 text-xs text-destructive">{stepError}</p> : null}
          <div className="mt-4 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={goBack}
              disabled={step === 0 || submitting}
            >
              {pickByLocale(locale, OS.backButton)}
            </Button>
            <div className="flex items-center gap-2">
              {isOptionalStep ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void goSkip()}
                  disabled={submitting || !sessionId}
                >
                  {pickByLocale(locale, OS.skipButton)}
                </Button>
              ) : null}
              {/* DS Button variant="warning" pairs bg-warning with
                  warning-foreground (AA-safe ≥4.5:1 in light + dark) and ships
                  the focus-visible ring — replacing the old
                  bg-warning-subtle/text-warning pairing (~2.4:1, WCAG 1.4.3
                  fail) with no focus ring. `loading` renders the spinner and
                  keeps the localized label (no English "Loading…" leak). */}
              <Button
                type="button"
                variant="warning"
                size="sm"
                onClick={() => void goNext()}
                disabled={!sessionId}
                loading={submitting}
                data-testid="onboarding-next"
              >
                {pickByLocale(locale, isFinal ? OS.finishButton : OS.nextButton)}
              </Button>
            </div>
          </div>
        </SectionCard>
      </div>
    </>
  );
}
