import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { FormField } from '@/components/FormField'
import { PrimaryButton } from '@/components/PrimaryButton'
import { useToast } from '@/components/Toast'
import { useTranslation } from '@/hooks/useTranslation'
import { pickRegistrationDoc } from '@/kyc/pickers'
import { companySchema, type CompanyValues } from '@/schemas/kyc'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'

export interface CompanyStepProps {
  readonly initial: CompanyValues
  readonly onNext: (values: CompanyValues) => void
  readonly onBack: () => void
}

export function CompanyStep({ initial, onNext, onBack }: CompanyStepProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const { control, handleSubmit, setValue, watch, formState } = useForm<CompanyValues>({
    resolver: zodResolver(companySchema),
    defaultValues: initial,
    mode: 'onBlur'
  })

  const docName = watch('registrationDocName')

  async function handlePickDoc(): Promise<void> {
    const result = await pickRegistrationDoc()
    if (!result.ok) {
      if (result.reason === 'failed') {
        toast.show(t('kyc.doc_picker_failed'), 'error')
      }
      return
    }
    setValue('registrationDocUri', result.uri, { shouldValidate: true })
    setValue('registrationDocName', result.name, { shouldValidate: true })
  }

  return (
    <View>
      <Controller
        control={control}
        name="tin"
        render={({ field, fieldState }) => (
          <FormField
            label={t('kyc.tin')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            keyboardType="number-pad"
            error={fieldState.error?.message}
          />
        )}
      />

      <Text style={styles.label}>{t('kyc.registration_doc')}</Text>
      <Pressable onPress={handlePickDoc} style={styles.tile}>
        <Text style={styles.tileName}>{docName || t('kyc.pick_document')}</Text>
        <Text style={styles.tileCta}>{t('kyc.pick_document')}</Text>
      </Pressable>

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

const styles = StyleSheet.create({
  label: { ...typography.caption, color: colors.inkMuted, marginBottom: spacing.xs },
  tile: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    padding: spacing.md,
    marginBottom: spacing.md
  },
  tileName: { ...typography.bodyStrong, color: colors.ink },
  tileCta: { ...typography.caption, color: colors.forest, marginTop: spacing.xs },
  actions: { flexDirection: 'row', marginTop: spacing.md },
  flex: { flex: 1 },
  spacer: { width: spacing.md }
})
