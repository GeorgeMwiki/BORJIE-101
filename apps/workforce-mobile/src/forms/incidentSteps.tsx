import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Controller, type Control } from 'react-hook-form'
import { Field } from './Field'
import { PhotoStrip } from './PhotoStrip'
import { VoiceRecorderControl } from './VoiceRecorderControl'
import { GpsCard } from './GpsCard'
import { Section } from '../components/Section'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'
import type {
  IncidentFullForm,
  IncidentKind,
  IncidentSeverity
} from './schemas/incident'
import type { CapturedMedia } from '../media/usePhotoPicker'
import type { LocationState } from '../location/useLocation'
import type { VoiceRecorderState } from '../media/useVoiceRecorder'

export interface IncidentI18n {
  common: { required: string }
  incident: {
    step1: string
    step2: string
    step3: string
    step4: string
    step5: string
    step6: string
    kindLabel: string
    kindInjury: string
    kindNearMiss: string
    kindEquipment: string
    kindEnvironmental: string
    severityLabel: string
    severityLow: string
    severityMedium: string
    severityHigh: string
    severityCritical: string
    locationLabel: string
    locationPlaceholder: string
    gpsCapture: string
    gpsCapturing: string
    gpsLatLng: string
    gpsAccuracy: string
    gpsNoGps: string
    photosHint: string
    addPhoto: string
    voiceHint: string
    voiceRecord: string
    voiceStop: string
    voiceRetake: string
    voiceLabel: string
    witnessesLabel: string
    witnessesPlaceholder: string
    reviewKind: string
    reviewSeverity: string
    reviewLocation: string
    reviewPhotos: string
    reviewVoice: string
    reviewWitnesses: string
    reviewVoiceNone: string
  }
}

interface RadioGroupProps<T extends string> {
  options: ReadonlyArray<{ value: T; label: string }>
  value: T | null
  onChange: (next: T) => void
}

function RadioGroup<T extends string>({
  options,
  value,
  onChange
}: RadioGroupProps<T>): JSX.Element {
  return (
    <View style={radioStyles.wrap}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[radioStyles.row, selected ? radioStyles.rowActive : null]}
          >
            <View style={[radioStyles.dot, selected ? radioStyles.dotActive : null]}>
              {selected ? <View style={radioStyles.dotInner} /> : null}
            </View>
            <Text style={[radioStyles.label, selected ? radioStyles.labelActive : null]}>
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

interface StepKindProps {
  control: Control<IncidentFullForm>
  t: IncidentI18n
}

export function StepKind({ control, t }: StepKindProps): JSX.Element {
  const options: ReadonlyArray<{ value: IncidentKind; label: string }> = [
    { value: 'injury', label: t.incident.kindInjury },
    { value: 'near-miss', label: t.incident.kindNearMiss },
    { value: 'equipment', label: t.incident.kindEquipment },
    { value: 'environmental', label: t.incident.kindEnvironmental }
  ]
  return (
    <Section title={t.incident.step1} hint={t.incident.kindLabel}>
      <Controller
        control={control}
        name="kind"
        render={({ field }) => (
          <RadioGroup<IncidentKind>
            options={options}
            value={field.value ?? null}
            onChange={field.onChange}
          />
        )}
      />
    </Section>
  )
}

export function StepSeverity({ control, t }: StepKindProps): JSX.Element {
  const options: ReadonlyArray<{ value: IncidentSeverity; label: string }> = [
    { value: 'low', label: t.incident.severityLow },
    { value: 'medium', label: t.incident.severityMedium },
    { value: 'high', label: t.incident.severityHigh },
    { value: 'critical', label: t.incident.severityCritical }
  ]
  return (
    <Section title={t.incident.step2} hint={t.incident.severityLabel}>
      <Controller
        control={control}
        name="severity"
        render={({ field }) => (
          <RadioGroup<IncidentSeverity>
            options={options}
            value={field.value ?? null}
            onChange={field.onChange}
          />
        )}
      />
    </Section>
  )
}

interface StepLocationProps {
  control: Control<IncidentFullForm>
  t: IncidentI18n
  gpsState: LocationState
}

export function StepLocation({ control, t, gpsState }: StepLocationProps): JSX.Element {
  return (
    <Section title={t.incident.step3}>
      <Controller
        control={control}
        name="location"
        render={({ field, fieldState }) => (
          <Field
            label={t.incident.locationLabel}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            placeholder={t.incident.locationPlaceholder}
            error={fieldState.error ? t.common.required : null}
          />
        )}
      />
      <GpsCard
        state={gpsState}
        fence={null}
        insideLabel={t.incident.gpsLatLng}
        outsideLabel={t.incident.gpsLatLng}
        capturingLabel={t.incident.gpsCapturing}
        latLngLabel={t.incident.gpsLatLng}
        accuracyLabel={t.incident.gpsAccuracy}
        distanceLabel={t.incident.gpsLatLng}
        noGpsLabel={t.incident.gpsNoGps}
      />
    </Section>
  )
}

interface StepPhotosProps {
  t: IncidentI18n
  photos: ReadonlyArray<CapturedMedia>
  onAddPhoto: () => void
  onRemovePhoto: (id: string) => void
}

export function StepPhotos({ t, photos, onAddPhoto, onRemovePhoto }: StepPhotosProps): JSX.Element {
  return (
    <Section title={t.incident.step4} hint={t.incident.photosHint}>
      <PhotoStrip
        photos={photos}
        onAdd={onAddPhoto}
        onRemove={onRemovePhoto}
        addLabel={t.incident.addPhoto}
      />
    </Section>
  )
}

interface StepVoiceWitnessesProps {
  control: Control<IncidentFullForm>
  t: IncidentI18n
  recorderState: VoiceRecorderState
  onStart: () => void
  onStop: () => void
  onReset: () => void
}

export function StepVoiceWitnesses({
  control,
  t,
  recorderState,
  onStart,
  onStop,
  onReset
}: StepVoiceWitnessesProps): JSX.Element {
  return (
    <Section title={t.incident.step5} hint={t.incident.voiceHint}>
      <VoiceRecorderControl
        state={recorderState}
        onStart={onStart}
        onStop={onStop}
        onReset={onReset}
        recordLabel={t.incident.voiceRecord}
        stopLabel={t.incident.voiceStop}
        retakeLabel={t.incident.voiceRetake}
        emptyLabel={t.incident.voiceLabel}
      />
      <Controller
        control={control}
        name="witnesses"
        render={({ field }) => (
          <Field
            label={t.incident.witnessesLabel}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            placeholder={t.incident.witnessesPlaceholder}
            multiline
          />
        )}
      />
    </Section>
  )
}

interface ReviewRow {
  label: string
  value: string
}

interface StepReviewProps {
  t: IncidentI18n
  rows: ReadonlyArray<ReviewRow>
  errorText?: string | null
}

export function StepReview({ t, rows, errorText }: StepReviewProps): JSX.Element {
  return (
    <Section title={t.incident.step6}>
      <View style={reviewStyles.card}>
        {rows.map((row) => (
          <View key={row.label} style={reviewStyles.row}>
            <Text style={reviewStyles.label}>{row.label}</Text>
            <Text style={reviewStyles.value}>{row.value}</Text>
          </View>
        ))}
      </View>
      {errorText ? <Text style={reviewStyles.error}>{errorText}</Text> : null}
    </Section>
  )
}

const radioStyles = StyleSheet.create({
  wrap: {
    gap: spacing.sm
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt
  },
  rowActive: {
    borderColor: colors.gold,
    backgroundColor: colors.surface
  },
  dot: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center'
  },
  dotActive: {
    borderColor: colors.gold
  },
  dotInner: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.gold
  },
  label: {
    color: colors.text,
    fontSize: fontSize.lead
  },
  labelActive: {
    color: colors.earth900,
    fontWeight: '700'
  }
})

const reviewStyles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    gap: spacing.sm
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md
  },
  label: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    fontWeight: '600'
  },
  value: {
    color: colors.earth900,
    fontSize: fontSize.body,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'right'
  },
  error: {
    marginTop: spacing.md,
    color: colors.danger,
    fontSize: fontSize.body,
    fontWeight: '600'
  }
})
