import { useState } from 'react'
import { useRouter } from 'expo-router'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { Screen } from '@/components/Screen'
import { FormField } from '@/components/FormField'
import { PrimaryButton } from '@/components/PrimaryButton'
import { useToast } from '@/components/Toast'
import { useTranslation } from '@/hooks/useTranslation'
import { sendBuyerOtp, verifyBuyerOtp } from '@/auth/session'
import { phoneSchema, otpSchema, type PhoneInput, type OtpInput } from '@/schemas/auth'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'

type Stage = 'phone' | 'otp'

function normaliseE164(raw: string): string {
  const digits = raw.replace(/[^0-9+]/g, '')
  if (digits.startsWith('+')) return digits
  if (digits.startsWith('255')) return `+${digits}`
  if (digits.startsWith('0')) return `+255${digits.slice(1)}`
  return `+${digits}`
}

export default function AuthLogin() {
  const router = useRouter()
  const { t } = useTranslation()
  const toast = useToast()
  const [stage, setStage] = useState<Stage>('phone')
  const [phone, setPhone] = useState<string>('')
  const [sending, setSending] = useState<boolean>(false)
  const [verifying, setVerifying] = useState<boolean>(false)

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

  async function handleSendOtp(values: PhoneInput): Promise<void> {
    setSending(true)
    try {
      const e164 = normaliseE164(values.phone)
      const result = await sendBuyerOtp(e164)
      if (result.error) {
        toast.show(result.error ?? t('auth.otp_failed'), 'error')
        return
      }
      setPhone(e164)
      setStage('otp')
      toast.show(t('auth.otp_sent'), 'success')
    } finally {
      setSending(false)
    }
  }

  async function handleVerifyOtp(values: OtpInput): Promise<void> {
    setVerifying(true)
    try {
      const result = await verifyBuyerOtp(phone, values.code)
      if (result.error) {
        toast.show(result.error ?? t('auth.verify_failed'), 'error')
        return
      }
      router.replace('/marketplace')
    } finally {
      setVerifying(false)
    }
  }

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
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                placeholder={t('auth.phone_placeholder')}
                keyboardType="phone-pad"
                error={fieldState.error?.message}
              />
            )}
          />
          <View style={{ height: spacing.sm }} />
          {sending ? <ActivityIndicator color={colors.forest} style={styles.spinner} /> : null}
          <PrimaryButton
            label={t('auth.send_otp')}
            onPress={phoneForm.handleSubmit(handleSendOtp)}
            disabled={sending}
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
                placeholder={t('auth.otp_placeholder')}
                keyboardType="number-pad"
                maxLength={6}
                error={fieldState.error?.message}
              />
            )}
          />
          <View style={{ height: spacing.sm }} />
          {verifying ? <ActivityIndicator color={colors.forest} style={styles.spinner} /> : null}
          <PrimaryButton
            label={t('auth.verify')}
            onPress={otpForm.handleSubmit(handleVerifyOtp)}
            disabled={verifying}
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
  terms: { ...typography.caption, color: colors.inkMuted, marginTop: spacing.xl, textAlign: 'center' },
  spinner: { marginBottom: spacing.sm }
})
