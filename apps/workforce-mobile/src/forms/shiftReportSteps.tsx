import { View } from 'react-native'
import { Controller, type Control } from 'react-hook-form'
import { Field } from './Field'
import { PhotoStrip } from './PhotoStrip'
import { VoiceRecorderControl } from './VoiceRecorderControl'
import { Section } from '../components/Section'
import type { ShiftReportFullForm } from './schemas/shiftReport'
import type { CapturedMedia } from '../media/usePhotoPicker'
import type {
  VoiceRecorderState
} from '../media/useVoiceRecorder'

interface CommonProps {
  control: Control<ShiftReportFullForm>
  t: {
    common: { required: string }
    shiftReport: {
      step1: string
      step2: string
      step3: string
      step4: string
      siteIdLabel: string
      siteIdPlaceholder: string
      workersCount: string
      hoursPerWorker: string
      fuelLitres: string
      equipmentNotes: string
      photosHint: string
      addPhoto: string
      blockers: string
      blockersHint: string
      voiceHint: string
      voiceRecord: string
      voiceStop: string
      voiceRetake: string
      voiceLabel: string
    }
  }
}

export function Step1({ control, t }: CommonProps): JSX.Element {
  return (
    <Section title={t.shiftReport.step1}>
      <Controller
        control={control}
        name="siteId"
        render={({ field, fieldState }) => (
          <Field
            label={t.shiftReport.siteIdLabel}
            value={field.value}
            onChangeText={field.onChange}
            placeholder={t.shiftReport.siteIdPlaceholder}
            autoCapitalize="characters"
            error={fieldState.error ? t.common.required : null}
          />
        )}
      />
      <Controller
        control={control}
        name="workersCount"
        render={({ field, fieldState }) => (
          <Field
            label={t.shiftReport.workersCount}
            value={field.value}
            onChangeText={field.onChange}
            keyboardType="number-pad"
            error={fieldState.error ? t.common.required : null}
          />
        )}
      />
      <Controller
        control={control}
        name="hoursPerWorker"
        render={({ field, fieldState }) => (
          <Field
            label={t.shiftReport.hoursPerWorker}
            value={field.value}
            onChangeText={field.onChange}
            keyboardType="decimal-pad"
            error={fieldState.error ? t.common.required : null}
          />
        )}
      />
    </Section>
  )
}

export function Step2({ control, t }: CommonProps): JSX.Element {
  return (
    <Section title={t.shiftReport.step2}>
      <Controller
        control={control}
        name="fuelLitres"
        render={({ field, fieldState }) => (
          <Field
            label={t.shiftReport.fuelLitres}
            value={field.value}
            onChangeText={field.onChange}
            keyboardType="decimal-pad"
            error={fieldState.error ? t.common.required : null}
          />
        )}
      />
      <Controller
        control={control}
        name="equipmentNotes"
        render={({ field }) => (
          <Field
            label={t.shiftReport.equipmentNotes}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            multiline
          />
        )}
      />
    </Section>
  )
}

interface Step3Props extends CommonProps {
  photos: ReadonlyArray<CapturedMedia>
  onAddPhoto: () => void
  onRemovePhoto: (id: string) => void
}

export function Step3({ control, t, photos, onAddPhoto, onRemovePhoto }: Step3Props): JSX.Element {
  return (
    <Section title={t.shiftReport.step3} hint={t.shiftReport.photosHint}>
      <PhotoStrip
        photos={photos}
        onAdd={onAddPhoto}
        onRemove={onRemovePhoto}
        addLabel={t.shiftReport.addPhoto}
      />
      <Controller
        control={control}
        name="blockers"
        render={({ field }) => (
          <Field
            label={t.shiftReport.blockers}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            multiline
            placeholder={t.shiftReport.blockersHint}
          />
        )}
      />
    </Section>
  )
}

interface Step4Props {
  recorderState: VoiceRecorderState
  onStart: () => void
  onStop: () => void
  onReset: () => void
  t: CommonProps['t']
}

export function Step4({ recorderState, onStart, onStop, onReset, t }: Step4Props): JSX.Element {
  return (
    <Section title={t.shiftReport.step4} hint={t.shiftReport.voiceHint}>
      <VoiceRecorderControl
        state={recorderState}
        onStart={onStart}
        onStop={onStop}
        onReset={onReset}
        recordLabel={t.shiftReport.voiceRecord}
        stopLabel={t.shiftReport.voiceStop}
        retakeLabel={t.shiftReport.voiceRetake}
        emptyLabel={t.shiftReport.voiceLabel}
      />
    </Section>
  )
}

export interface StepNavProps {
  step: number
  total: number
  submitting: boolean
  labels: { back: string; next: string; submit: string; submitting: string }
  onBack: () => void
  onNext: () => void
  onSubmit: () => void
}

import { StyleSheet } from 'react-native'
import { Button } from './Button'
import { spacing } from '../theme/spacing'

export function StepNav({ step, total, submitting, labels, onBack, onNext, onSubmit }: StepNavProps): JSX.Element {
  return (
    <View style={navStyles.actions}>
      {step > 0 ? <Button label={labels.back} variant="ghost" onPress={onBack} /> : null}
      {step < total - 1 ? (
        <Button label={labels.next} onPress={onNext} />
      ) : (
        <Button
          label={submitting ? labels.submitting : labels.submit}
          onPress={onSubmit}
          loading={submitting}
        />
      )}
    </View>
  )
}

const navStyles = StyleSheet.create({
  actions: {
    gap: spacing.sm,
    marginTop: spacing.md
  }
})
