import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { View } from 'react-native'
import { FormField } from '@/components/FormField'
import { PrimaryButton } from '@/components/PrimaryButton'
import { useTranslation } from '@/hooks/useTranslation'
import { personalSchema, type PersonalValues } from '@/schemas/kyc'
import { spacing } from '@/theme/spacing'

export interface PersonalStepProps {
  readonly initial: PersonalValues
  readonly onNext: (values: PersonalValues) => void
}

export function PersonalStep({ initial, onNext }: PersonalStepProps) {
  const { t } = useTranslation()
  const { control, handleSubmit, formState } = useForm<PersonalValues>({
    resolver: zodResolver(personalSchema),
    defaultValues: initial,
    mode: 'onBlur'
  })

  return (
    <View>
      <Controller
        control={control}
        name="fullName"
        render={({ field, fieldState }) => (
          <FormField
            label={t('kyc.full_name')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            autoCapitalize="words"
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="phone"
        render={({ field, fieldState }) => (
          <FormField
            label={t('kyc.phone')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            keyboardType="phone-pad"
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="email"
        render={({ field, fieldState }) => (
          <FormField
            label={t('kyc.email')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            autoCapitalize="none"
            keyboardType="email-address"
            error={fieldState.error?.message}
          />
        )}
      />
      <View style={{ marginTop: spacing.md }}>
        <PrimaryButton
          label={t('kyc.next')}
          onPress={handleSubmit(onNext)}
          disabled={!formState.isValid && formState.isSubmitted}
        />
      </View>
    </View>
  )
}
