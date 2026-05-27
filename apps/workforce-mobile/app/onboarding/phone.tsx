import { useMemo, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { Button } from '../../src/forms/Button'
import { Field } from '../../src/forms/Field'
import { WizardShell } from '../../src/onboarding/WizardShell'
import { useOnboardingDraft } from '../../src/onboarding/state'
import { useAuth } from '../../src/auth/useAuth'
import { pickStrings } from '../../src/i18n'
import { colors } from '../../src/theme/colors'
import { fontSize, spacing } from '../../src/theme/spacing'

const PHONE_REGEX = /^\+255\s?7\d{2}\s?\d{3}\s?\d{3}$/

export default function PhoneStep(): JSX.Element {
  const { current, update, markStepComplete } = useOnboardingDraft()
  const { sendOtp, verifyOtp } = useAuth()
  const t = useMemo(() => pickStrings(current.lang), [current.lang])
  const copy = t.onboarding.phone

  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [otpSent, setOtpSent] = useState<boolean>(false)
  const [otpError, setOtpError] = useState<string | null>(null)
  const [sending, setSending] = useState<boolean>(false)
  const [verifying, setVerifying] = useState<boolean>(false)

  function changePhone(next: string): void {
    setPhoneError(null)
    update({ phone: maskPhone(next) })
  }

  function changeOtp(next: string): void {
    setOtpError(null)
    update({ otpCode: next.replace(/[^0-9]/g, '').slice(0, 6) })
  }

  async function handleSendOtp(): Promise<void> {
    if (!isValidPhone(current.phone)) {
      setPhoneError(copy.errorPhone)
      return
    }
    setSending(true)
    setPhoneError(null)
    try {
      const result = await sendOtp(toE164(current.phone))
      if (result.error) {
        setPhoneError(result.error)
        return
      }
      setOtpSent(true)
    } finally {
      setSending(false)
    }
  }

  async function handleConfirmOtp(): Promise<void> {
    if (current.otpCode.length < 6) {
      setOtpError(copy.errorOtp)
      return
    }
    setVerifying(true)
    setOtpError(null)
    try {
      const result = await verifyOtp(toE164(current.phone), current.otpCode)
      if (result.error) {
        setOtpError(result.error)
        return
      }
      update({ otpVerified: true })
      markStepComplete('phone')
      router.push('/onboarding/identity')
    } finally {
      setVerifying(false)
    }
  }

  const showOtp = otpSent
  const phoneSubmitDisabled = sending || current.phone.length === 0
  const otpSubmitDisabled = verifying || current.otpCode.length < 6

  return (
    <WizardShell
      badge="OTP"
      title={showOtp ? copy.otpTitle : copy.title}
      subtitle={showOtp ? copy.otpSubtitle : copy.subtitle}
      footer={
        showOtp ? (
          <View>
            {verifying ? <ActivityIndicator color={colors.gold} style={styles.spinner} /> : null}
            <Button label={copy.otpConfirm} onPress={handleConfirmOtp} disabled={otpSubmitDisabled} />
          </View>
        ) : (
          <View>
            {sending ? <ActivityIndicator color={colors.gold} style={styles.spinner} /> : null}
            <Button label={copy.cta} onPress={handleSendOtp} disabled={phoneSubmitDisabled} />
          </View>
        )
      }
    >
      {showOtp ? (
        <View>
          <Field
            label={copy.otpLabel}
            value={current.otpCode}
            onChangeText={changeOtp}
            placeholder={copy.otpPlaceholder}
            keyboardType="number-pad"
            error={otpError}
          />
          <Text style={styles.hint}>{copy.resend}</Text>
        </View>
      ) : (
        <Field
          label={copy.label}
          value={current.phone}
          onChangeText={changePhone}
          placeholder={copy.placeholder}
          keyboardType="phone-pad"
          error={phoneError}
        />
      )}
    </WizardShell>
  )
}

function maskPhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '').slice(0, 12)
  if (digits.length === 0) return ''
  const normalised = digits.startsWith('255')
    ? digits
    : digits.startsWith('0')
      ? `255${digits.slice(1)}`
      : `255${digits}`
  const tail = normalised.slice(3, 12)
  const parts: string[] = []
  if (tail.length > 0) parts.push(tail.slice(0, 3))
  if (tail.length > 3) parts.push(tail.slice(3, 6))
  if (tail.length > 6) parts.push(tail.slice(6, 9))
  return `+255 ${parts.join(' ')}`.trim()
}

function isValidPhone(formatted: string): boolean {
  return PHONE_REGEX.test(formatted)
}

/** Convert the spaced `+255 7XX XXX XXX` UI form to E.164 (`+2557XXXXXXXX`). */
function toE164(formatted: string): string {
  return formatted.replace(/\s+/g, '')
}

const styles = StyleSheet.create({
  hint: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.sm
  },
  spinner: {
    marginBottom: spacing.sm
  }
})
