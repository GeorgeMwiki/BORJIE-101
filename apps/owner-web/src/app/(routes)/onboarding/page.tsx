'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
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
  useAdvanceOnboarding,
  useCompleteOnboarding,
  useStartOnboarding,
  type OnboardingStep,
} from '@/lib/queries/onboarding';

const STEPS: ReadonlyArray<StepperStep> = [
  { id: 'kyb', label: 'NIDA + KYB', labelSw: 'NIDA + KYB' },
  { id: 'licences', label: 'Licence import', labelSw: 'Pakia leseni' },
  { id: 'sites', label: 'Site geometry', labelSw: 'Mipaka ya tovuti' },
  { id: 'drill_holes', label: 'Drill-hole batch', labelSw: 'Mashimo ya kuchimba' },
  { id: 'cockpit_seed', label: 'Cockpit seed', labelSw: 'Anza dashibodi' },
];

const STEP_KIND: ReadonlyArray<OnboardingStep> = [
  'kyb',
  'licences',
  'sites',
  'drill_holes',
  'cockpit_seed',
];

/**
 * O-W-21 — Owner onboarding wizard. Five steps, server-persisted via
 * the onboarding-orchestrator gateway routes
 * (start / advance / complete). Each Next click validates the local
 * step state, POSTs the payload, and only advances on success. The
 * final step redirects to `/` once complete returns 2xx.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<number>(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [licenceFiles, setLicenceFiles] = useState<ReadonlyArray<File>>([]);
  const [siteFiles, setSiteFiles] = useState<ReadonlyArray<File>>([]);
  const [drillFiles, setDrillFiles] = useState<ReadonlyArray<File>>([]);
  const [headline, setHeadline] = useState<string>('');
  const [stepError, setStepError] = useState<string | null>(null);

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
            {
              fullName: values.directorFullName,
              nidaId: values.directorNidaId,
              role: 'director',
            },
          ],
        };
      }
      if (index === 1) return { licences: licenceFiles.map((file) => ({ name: file.name })) };
      if (index === 2) return { sites: siteFiles.map((file) => ({ name: file.name })) };
      if (index === 3) return { rows: drillFiles.map((file) => ({ name: file.name })) };
      if (index === 4) return { headline };
      return null;
    },
    [drillFiles, headline, kybForm, licenceFiles, siteFiles],
  );

  const validateStep = useCallback(
    async (index: number): Promise<boolean> => {
      if (index === 0) return kybForm.trigger();
      if (index === 1) return licenceFiles.length > 0;
      if (index === 2) return siteFiles.length > 0;
      if (index === 3) return drillFiles.length > 0;
      return true;
    },
    [drillFiles.length, kybForm, licenceFiles.length, siteFiles.length],
  );

  const goNext = useCallback(async (): Promise<void> => {
    setStepError(null);
    const valid = await validateStep(step);
    if (!valid) {
      setStepError('Please complete this step before continuing. / Tafadhali kamilisha hatua hii.');
      return;
    }
    if (!sessionId) {
      setStepError('Session not ready. / Kipindi hakijaanza.');
      return;
    }
    const payload = buildPayload(step);
    if (payload === null) return;
    try {
      await advanceMutation.mutateAsync({
        sessionId,
        step: STEP_KIND[step]!,
        payload,
      });
      if (step === STEPS.length - 1) {
        await completeMutation.mutateAsync(sessionId);
        router.push('/');
        return;
      }
      setStep((current) => current + 1);
    } catch (error) {
      setStepError((error as Error)?.message ?? 'unknown error');
    }
  }, [advanceMutation, buildPayload, completeMutation, router, sessionId, step, validateStep]);

  const goBack = useCallback((): void => {
    setStepError(null);
    setStep((current) => Math.max(current - 1, 0));
  }, []);

  const isFinal = step === STEPS.length - 1;
  const submitting = advanceMutation.isPending || completeMutation.isPending;

  return (
    <>
      <ScreenHeader slug="onboarding" />
      <div className="space-y-4 px-8 py-6">
        <SectionCard title="Progress" subtitle="Maendeleo">
          <Stepper steps={STEPS} current={step} />
        </SectionCard>
        <SectionCard
          title={`Step ${step + 1} of ${STEPS.length}`}
          subtitle={`${STEPS[step]!.label} / ${STEPS[step]!.labelSw}`}
        >
          {step === 0 ? <KybStep form={kybForm} /> : null}
          {step === 1 ? (
            <FileUploadStep
              accept=".pdf"
              hintEn="Drop PML/PL/SML/ML PDFs here"
              hintSw="Tia PML/PL/SML/ML hapa"
              files={licenceFiles}
              onChange={setLicenceFiles}
            />
          ) : null}
          {step === 2 ? (
            <FileUploadStep
              accept=".geojson,.json"
              hintEn="Drop a GeoJSON polygon for each site"
              hintSw="Tia GeoJSON ya kila tovuti"
              files={siteFiles}
              onChange={setSiteFiles}
            />
          ) : null}
          {step === 3 ? (
            <FileUploadStep
              accept=".csv"
              hintEn="Drop the first drill-hole CSV batch"
              hintSw="Tia CSV ya mashimo ya kwanza"
              files={drillFiles}
              onChange={setDrillFiles}
            />
          ) : null}
          {step === 4 ? <CockpitSeedStep headline={headline} onChange={setHeadline} /> : null}
          {stepError ? (
            <p className="mt-3 text-xs text-destructive">{stepError}</p>
          ) : null}
          <div className="mt-4 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={goBack}
              disabled={step === 0 || submitting}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-surface disabled:opacity-40"
            >
              Back / Rudi
            </button>
            <button
              type="button"
              onClick={() => void goNext()}
              disabled={submitting || !sessionId}
              className="inline-flex items-center gap-2 rounded-md border border-warning bg-warning-subtle/30 px-3 py-1.5 text-xs text-warning hover:bg-warning-subtle/50 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {isFinal ? 'Finish / Maliza' : 'Next / Endelea'}
            </button>
          </div>
        </SectionCard>
      </div>
    </>
  );
}
