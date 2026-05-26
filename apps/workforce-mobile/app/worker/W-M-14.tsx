import { useCallback, useMemo, useState } from 'react'
import { View } from 'react-native'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Button } from '../../src/forms/Button'
import { WizardSteps } from '../../src/forms/WizardSteps'
import { ConfirmationCard } from '../../src/forms/ConfirmationCard'
import {
  StepKind,
  StepSeverity,
  StepLocation,
  StepPhotos,
  StepVoiceWitnesses,
  StepReview
} from '../../src/forms/incidentSteps'
import { useI18n } from '../../src/i18n/useI18n'
import { usePhotoPicker, type CapturedMedia } from '../../src/media/usePhotoPicker'
import { useVoiceRecorder } from '../../src/media/useVoiceRecorder'
import { useLocation } from '../../src/location/useLocation'
import { useOnlineStatus } from '../../src/offline/useOnlineStatus'
import { miningApi } from '../../src/api/client'
import { ApiError } from '../../src/api/errors'
import {
  incidentFullSchema,
  toRemotePayload,
  type IncidentFullForm,
  type IncidentLocalPayload
} from '../../src/forms/schemas/incident'

const SCREEN_ID = 'W-M-14'
const TOTAL_STEPS = 6

const STEP_FIELDS: ReadonlyArray<ReadonlyArray<keyof IncidentFullForm>> = [
  ['kind'],
  ['severity'],
  ['location'],
  [],
  ['witnesses'],
  []
]

interface SubmittedRef {
  reference: string
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <IncidentForm />
      </ScreenShell>
    </RoleGuard>
  )
}

function parseWitnesses(raw: string | undefined): ReadonlyArray<string> {
  if (!raw) return []
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

function IncidentForm(): JSX.Element {
  const { t } = useI18n()
  const { online } = useOnlineStatus()
  const [step, setStep] = useState<number>(0)
  const [photos, setPhotos] = useState<ReadonlyArray<CapturedMedia>>([])
  const [submitted, setSubmitted] = useState<SubmittedRef | null>(null)
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const photoPicker = usePhotoPicker()
  const recorder = useVoiceRecorder()
  const location = useLocation({ auto: false })

  const form = useForm<IncidentFullForm>({
    resolver: zodResolver(incidentFullSchema),
    mode: 'onChange',
    defaultValues: {
      kind: undefined as unknown as IncidentFullForm['kind'],
      severity: undefined as unknown as IncidentFullForm['severity'],
      location: '',
      witnesses: ''
    }
  })

  const stepLabels: ReadonlyArray<string> = [
    t.incident.step1,
    t.incident.step2,
    t.incident.step3,
    t.incident.step4,
    t.incident.step5,
    t.incident.step6
  ]

  const goNext = useCallback(async (): Promise<void> => {
    const fields = STEP_FIELDS[step]
    if (fields && fields.length > 0) {
      const valid = await form.trigger(fields)
      if (!valid) return
    }
    if (step === 2 && location.state.status === 'idle') {
      void location.capture()
    }
    setStep((current) => Math.min(current + 1, TOTAL_STEPS - 1))
  }, [form, step, location])

  const goBack = useCallback((): void => {
    setStep((current) => Math.max(current - 1, 0))
  }, [])

  const addPhoto = useCallback(async (): Promise<void> => {
    const media = await photoPicker.takePhoto()
    if (media) {
      setPhotos((current) => [...current, media])
    }
  }, [photoPicker])

  const removePhoto = useCallback((id: string): void => {
    setPhotos((current) => current.filter((photo) => photo.id !== id))
  }, [])

  const buildPayload = useCallback(
    (values: IncidentFullForm): IncidentLocalPayload => ({
      kind: values.kind,
      severity: values.severity,
      location: values.location,
      gps: location.state.coords
        ? {
            latitude: location.state.coords.latitude,
            longitude: location.state.coords.longitude,
            accuracy: location.state.coords.accuracy,
            capturedAt: location.state.coords.capturedAt
          }
        : null,
      photos: photos.map((photo) => ({
        uri: photo.uri,
        capturedAt: photo.capturedAt,
        mimeType: photo.mimeType
      })),
      voiceNote: recorder.state.recording
        ? {
            uri: recorder.state.recording.uri,
            durationMs: recorder.state.recording.durationMs,
            recordedAt: recorder.state.recording.recordedAt
          }
        : null,
      witnesses: parseWitnesses(values.witnesses),
      submittedAt: Date.now()
    }),
    [location.state.coords, photos, recorder.state.recording]
  )

  const submitNow = useCallback(
    async (values: IncidentFullForm): Promise<void> => {
      setSubmitting(true)
      setSubmitError(null)
      try {
        const local = buildPayload(values)
        const remote = toRemotePayload(local)
        const response = await miningApi.post<{ id?: string }>('/incidents', remote)
        const reference = response?.id ?? `local_${local.submittedAt}`
        setSubmitted({ reference })
      } catch (error) {
        const message =
          error instanceof ApiError ? error.message : (error as Error)?.message ?? 'unknown'
        setSubmitError(message)
      } finally {
        setSubmitting(false)
      }
    },
    [buildPayload]
  )

  const onSubmit = form.handleSubmit(submitNow)

  const resetForm = useCallback((): void => {
    form.reset()
    setPhotos([])
    recorder.reset()
    setStep(0)
    setSubmitted(null)
    setSubmitError(null)
  }, [form, recorder])

  const reviewRows = useMemo(() => {
    const values = form.getValues()
    const kindLabelMap: Record<IncidentFullForm['kind'], string> = {
      injury: t.incident.kindInjury,
      'near-miss': t.incident.kindNearMiss,
      equipment: t.incident.kindEquipment,
      environmental: t.incident.kindEnvironmental
    }
    const severityLabelMap: Record<IncidentFullForm['severity'], string> = {
      low: t.incident.severityLow,
      medium: t.incident.severityMedium,
      high: t.incident.severityHigh,
      critical: t.incident.severityCritical
    }
    const witnesses = parseWitnesses(values.witnesses)
    return [
      { label: t.incident.reviewKind, value: values.kind ? kindLabelMap[values.kind] : '—' },
      {
        label: t.incident.reviewSeverity,
        value: values.severity ? severityLabelMap[values.severity] : '—'
      },
      { label: t.incident.reviewLocation, value: values.location || '—' },
      { label: t.incident.reviewPhotos, value: String(photos.length) },
      {
        label: t.incident.reviewVoice,
        value: recorder.state.recording ? 'OK' : t.incident.reviewVoiceNone
      },
      {
        label: t.incident.reviewWitnesses,
        value: witnesses.length > 0 ? witnesses.join(', ') : '—'
      }
    ]
  }, [form, photos.length, recorder.state.recording, t.incident])

  if (submitted) {
    return (
      <View>
        <Section title={t.common.saved}>
          <ConfirmationCard
            title={t.incident.confirmTitle}
            message={t.incident.confirmMessage}
            refLabel={t.common.reference}
            refValue={submitted.reference}
            pendingSyncLabel={t.common.pendingSync}
            online={online}
          />
        </Section>
        <Button label={t.common.newEntry} variant="secondary" onPress={resetForm} />
      </View>
    )
  }

  return (
    <View>
      <WizardSteps total={TOTAL_STEPS} current={step} labels={stepLabels} />
      {step === 0 ? <StepKind control={form.control} t={t} /> : null}
      {step === 1 ? <StepSeverity control={form.control} t={t} /> : null}
      {step === 2 ? (
        <StepLocation control={form.control} t={t} gpsState={location.state} />
      ) : null}
      {step === 3 ? (
        <StepPhotos
          t={t}
          photos={photos}
          onAddPhoto={() => void addPhoto()}
          onRemovePhoto={removePhoto}
        />
      ) : null}
      {step === 4 ? (
        <StepVoiceWitnesses
          control={form.control}
          t={t}
          recorderState={recorder.state}
          onStart={() => void recorder.start()}
          onStop={() => void recorder.stop()}
          onReset={recorder.reset}
        />
      ) : null}
      {step === 5 ? (
        <StepReview
          t={t}
          rows={reviewRows}
          errorText={submitError ? t.incident.submitFailed : null}
        />
      ) : null}
      <View>
        {step > 0 ? (
          <Button label={t.common.back} variant="ghost" onPress={goBack} />
        ) : null}
        {step < TOTAL_STEPS - 1 ? (
          <Button label={t.common.next} onPress={() => void goNext()} />
        ) : (
          <Button
            label={
              submitError
                ? t.common.retry
                : submitting
                  ? t.common.submitting
                  : t.common.submit
            }
            onPress={() => void onSubmit()}
            loading={submitting}
          />
        )}
      </View>
    </View>
  )
}
