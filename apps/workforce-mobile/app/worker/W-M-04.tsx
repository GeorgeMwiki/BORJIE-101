import { useCallback, useState } from 'react'
import { View } from 'react-native'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Button } from '../../src/forms/Button'
import { WizardSteps } from '../../src/forms/WizardSteps'
import { ConfirmationCard } from '../../src/forms/ConfirmationCard'
import { Step1, Step2, Step3, Step4, StepNav } from '../../src/forms/shiftReportSteps'
import { useI18n } from '../../src/i18n/useI18n'
import { usePhotoPicker, type CapturedMedia } from '../../src/media/usePhotoPicker'
import { useVoiceRecorder } from '../../src/media/useVoiceRecorder'
import { useOnlineStatus } from '../../src/offline/useOnlineStatus'
import { enqueueWrite } from '../../src/sync/queue'
import {
  shiftReportFullSchema,
  type ShiftReportFullForm,
  type ShiftReportPayload
} from '../../src/forms/schemas/shiftReport'

const SCREEN_ID = 'W-M-04'
const TOTAL_STEPS = 4

const STEP_FIELDS: ReadonlyArray<ReadonlyArray<keyof ShiftReportFullForm>> = [
  ['siteId', 'workersCount', 'hoursPerWorker'],
  ['fuelLitres', 'equipmentNotes'],
  ['blockers'],
  []
]

interface SubmittedRef {
  queueId: string
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <ShiftReportForm />
      </ScreenShell>
    </RoleGuard>
  )
}

function ShiftReportForm(): JSX.Element {
  const { t } = useI18n()
  const { online } = useOnlineStatus()
  const [step, setStep] = useState<number>(0)
  const [photos, setPhotos] = useState<ReadonlyArray<CapturedMedia>>([])
  const [submitted, setSubmitted] = useState<SubmittedRef | null>(null)
  const [submitting, setSubmitting] = useState<boolean>(false)
  const photoPicker = usePhotoPicker()
  const recorder = useVoiceRecorder()

  const form = useForm<ShiftReportFullForm>({
    resolver: zodResolver(shiftReportFullSchema),
    mode: 'onChange',
    defaultValues: {
      siteId: '',
      workersCount: '',
      hoursPerWorker: '',
      fuelLitres: '',
      equipmentNotes: '',
      blockers: ''
    }
  })

  const stepLabels: ReadonlyArray<string> = [
    t.shiftReport.step1,
    t.shiftReport.step2,
    t.shiftReport.step3,
    t.shiftReport.step4
  ]

  const goNext = useCallback(async (): Promise<void> => {
    const fields = STEP_FIELDS[step]
    if (fields && fields.length > 0) {
      const valid = await form.trigger(fields)
      if (!valid) {
        return
      }
    }
    setStep((current) => Math.min(current + 1, TOTAL_STEPS - 1))
  }, [form, step])

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

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true)
    try {
      const payload: ShiftReportPayload = {
        siteId: values.siteId,
        workersCount: Number(values.workersCount),
        hoursPerWorker: Number(values.hoursPerWorker),
        fuelLitres: Number(values.fuelLitres),
        equipmentNotes: values.equipmentNotes ?? '',
        blockers: values.blockers ?? '',
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
        submittedAt: Date.now()
      }
      const entry = await enqueueWrite('shift_report', payload)
      setSubmitted({ queueId: entry.id })
    } catch (error) {
      console.error('Shift report submit failed:', error)
    } finally {
      setSubmitting(false)
    }
  })

  const resetForm = useCallback((): void => {
    form.reset()
    setPhotos([])
    recorder.reset()
    setStep(0)
    setSubmitted(null)
  }, [form, recorder])

  if (submitted) {
    return (
      <View>
        <Section title={t.common.saved}>
          <ConfirmationCard
            title={t.shiftReport.confirmTitle}
            message={t.shiftReport.confirmMessage}
            refLabel={t.common.reference}
            refValue={submitted.queueId}
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
      {step === 0 ? <Step1 control={form.control} t={t} /> : null}
      {step === 1 ? <Step2 control={form.control} t={t} /> : null}
      {step === 2 ? (
        <Step3
          control={form.control}
          t={t}
          photos={photos}
          onAddPhoto={() => void addPhoto()}
          onRemovePhoto={removePhoto}
        />
      ) : null}
      {step === 3 ? (
        <Step4
          recorderState={recorder.state}
          onStart={() => void recorder.start()}
          onStop={() => void recorder.stop()}
          onReset={recorder.reset}
          t={t}
        />
      ) : null}
      <StepNav
        step={step}
        total={TOTAL_STEPS}
        submitting={submitting}
        labels={{
          back: t.common.back,
          next: t.common.next,
          submit: t.common.submit,
          submitting: t.common.submitting
        }}
        onBack={goBack}
        onNext={() => void goNext()}
        onSubmit={() => void onSubmit()}
      />
    </View>
  )
}
