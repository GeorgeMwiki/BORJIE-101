import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { StyleSheet, Switch, Text, View } from 'react-native'
import { FormField } from '@/components/FormField'
import { PrimaryButton } from '@/components/PrimaryButton'
import { useTranslation } from '@/hooks/useTranslation'
import { amlSchema, type AmlValues } from '@/schemas/kyc'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'

export interface AmlStepProps {
  readonly initial: AmlValues
  readonly onNext: (values: AmlValues) => void
  readonly onBack: () => void
}

export function AmlStep({ initial, onNext, onBack }: AmlStepProps) {
  const { t } = useTranslation()
  const { control, handleSubmit, formState } = useForm<AmlValues>({
    resolver: zodResolver(amlSchema),
    defaultValues: initial,
    mode: 'onBlur'
  })

  return (
    <View>
      <Controller
        control={control}
        name="sourceOfFunds"
        render={({ field, fieldState }) => (
          <FormField
            label={t('kyc.source_of_funds')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            placeholder={t('kyc.source_of_funds_hint')}
            multiline
            numberOfLines={3}
            error={fieldState.error?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="isPep"
        render={({ field }) => (
          <ToggleRow
            label={t('kyc.pep_label')}
            value={Boolean(field.value)}
            onChange={(v) => field.onChange(v)}
          />
        )}
      />

      <Controller
        control={control}
        name="sanctionsConsent"
        render={({ field, fieldState }) => (
          <ToggleRow
            label={t('kyc.sanctions_consent')}
            value={Boolean(field.value)}
            onChange={(v) => field.onChange(v)}
            error={Boolean(fieldState.error)}
          />
        )}
      />

      <View style={styles.actions}>
        <View style={styles.flex}>
          <PrimaryButton label={t('kyc.back')} variant="ghost" onPress={onBack} />
        </View>
        <View style={styles.spacer} />
        <View style={styles.flex}>
          <PrimaryButton
            label={t('kyc.next')}
            onPress={handleSubmit(onNext)}
            disabled={!formState.isValid && formState.isSubmitted}
          />
        </View>
      </View>
    </View>
  )
}

interface ToggleRowProps {
  readonly label: string
  readonly value: boolean
  readonly onChange: (next: boolean) => void
  readonly error?: boolean
}

function ToggleRow({ label, value, onChange, error }: ToggleRowProps) {
  return (
    <View style={styles.toggleRow}>
      <Text style={[styles.toggleLabel, error ? styles.toggleError : undefined]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.forest, false: colors.line }} />
    </View>
  )
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line
  },
  toggleLabel: { ...typography.body, color: colors.ink, flex: 1, paddingRight: spacing.md },
  toggleError: { color: colors.danger },
  actions: { flexDirection: 'row', marginTop: spacing.md },
  flex: { flex: 1 },
  spacer: { width: spacing.md }
})
