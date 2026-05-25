import { useState } from 'react'
import { useRouter } from 'expo-router'
import { useMutation } from '@tanstack/react-query'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { StyleSheet, Text, View } from 'react-native'
import { Screen } from '@/components/Screen'
import { FormField } from '@/components/FormField'
import { PrimaryButton } from '@/components/PrimaryButton'
import { useToast } from '@/components/Toast'
import { useTranslation } from '@/hooks/useTranslation'
import { requestOtp, verifyOtp } from '@/api/auth'
import { setCurrentUser } from '@/auth/session'
import { phoneSchema, otpSchema, type PhoneInput, type OtpInput } from '@/schemas/auth'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'

type Stage = 'phone' | 'otp'

export default function AuthLogin() {
  const router = useRouter()
  const { t } = useTranslation()
  const toast = useToast()
  const [stage, setStage] = useState<Stage>('phone')
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [phone, setPhone] = useState('')

  const phoneForm = useForm<PhoneInput>({
    resolver: zodResolver(phoneSchema),
    defaultValues: { phone: '' },
    mode: 'onBlur'
  })

  const otpForm = useForm<OtpInput>({
    resolver: zodResolver(otpSchema),
    defaultValues: { code: '' },
    mode: 'onBlur'
  })

  const otpMutation = useMutation({
    mutationFn: requestOtp,
    onSuccess: (result) => {
      setChallengeId(result.challengeId)
      setStage('otp')
      toast.show(t('auth.otp_sent'), 'success')
    },
    onError: () => toast.show(t('auth.otp_failed'), 'error')
  })

  const verifyMutation = useMutation({
    mutationFn: verifyOtp,
    onSuccess: (result) => {
      setCurrentUser(result.user)
      router.replace('/marketplace')
    },
    onError: () => toast.show(t('auth.verify_failed'), 'error')
  })

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={styles.brand}>{t('app.name')}</Text>
        <Text style={styles.slogan}>{t('app.slogan')}</Text>
      </View>

      <Text style={styles.title}>{t('auth.login_title')}</Text>

      {stage === 'phone' ? (
        <View>
          <Controller
            control={phoneForm.control}
            name="phone"
            render={({ field, fieldState }) => (
              <FormField
                label={t('auth.phone_label')}
                value={field.value}
                onChangeText={(v) => {
                  field.onChange(v)
                  setPhone(v)
                }}
                onBlur={field.onBlur}
                placeholder={t('auth.phone_placeholder')}
                keyboardType="phone-pad"
                error={fieldState.error?.message}
              />
            )}
          />
          <View style={{ height: spacing.sm }} />
          <PrimaryButton
            label={t('auth.send_otp')}
            onPress={phoneForm.handleSubmit((values) => otpMutation.mutate({ phone: values.phone }))}
            disabled={otpMutation.isPending}
          />
        </View>
      ) : (
        <View>
          <Controller
            control={otpForm.control}
            name="code"
            render={({ field, fieldState }) => (
              <FormField
                label={t('auth.otp_label')}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                placeholder="123456"
                keyboardType="number-pad"
                maxLength={6}
                error={fieldState.error?.message}
              />
            )}
          />
          <View style={{ height: spacing.sm }} />
          <PrimaryButton
            label={t('auth.verify')}
            onPress={otpForm.handleSubmit((values) =>
              verifyMutation.mutate({
                challengeId: challengeId ?? '',
                phone,
                code: values.code
              })
            )}
            disabled={verifyMutation.isPending}
          />
        </View>
      )}

      <Text style={styles.terms}>{t('auth.terms')}</Text>
    </Screen>
  )
}

const styles = StyleSheet.create({
  hero: { marginBottom: spacing.xxl, alignItems: 'center' },
  brand: { ...typography.display, color: colors.forest },
  slogan: { ...typography.body, color: colors.copper, marginTop: spacing.xs },
  title: { ...typography.title, color: colors.ink, marginBottom: spacing.lg },
  terms: { ...typography.caption, color: colors.inkMuted, marginTop: spacing.xl, textAlign: 'center' }
})
