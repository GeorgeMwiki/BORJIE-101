import { useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { Button } from '../../src/forms/Button'
import { Field } from '../../src/forms/Field'
import { WizardShell } from '../../src/onboarding/WizardShell'
import { useOnboardingDraft } from '../../src/onboarding/state'
import { pickStrings } from '../../src/i18n'
import { colors } from '../../src/theme/colors'
import { fontSize, spacing } from '../../src/theme/spacing'

const PHONE_REGEX = /^\+255\s?7\d{2}\s?\d{3}\s?\d{3}$/
const DEFAULT_OTP = '123456'

export default function PhoneStep(): JSX.Element {
  const { current, update, markStepComplete } = useOnboardingDraft()
  const t = useMemo(() => pickStrings(current.lang), [current.lang])
  const copy = t.onboarding.phone

  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [otpSent, setOtpSent] = useState<boolean>(false)
  const [otpError, setOtpError] = useState<string | null>(null)

  function changePhone(next: string): void {
    setPhoneError(null)
    update({ phone: maskPhone(next) })
  }

  function changeOtp(next: string): void {
    setOtpError(null)
    update({ otpCode: next.replace(/[^0-9]/g, '').slice(0, 6) })
  }

  function sendOtp(): void {
    if (!PHONE_REGEX.test(current.phone.replace(/\s/g, '').replace(/^\+255(\d{9})$/, '+255 $1'))) {
      if (!isValidPhone(current.phone)) {
        setPhoneError(copy.errorPhone)
        return
      }
    }
    setOtpSent(true)
  }

  function confirmOtp(): void {
    if (current.otpCode !== DEFAULT_OTP) {
      setOtpError(copy.errorOtp)
      return
    }
    update({ otpVerified: true })
    markStepComplete('phone')
    router.push('/onboarding/identity')
  }

  const showOtp = otpSent

  return (
    <WizardShell
      badge="OTP"
      title={showOtp ? copy.otpTitle : copy.title}
      subtitle={showOtp ? copy.otpSubtitle : copy.subtitle}
      footer={
        showOtp ? (
          <Button label={copy.otpConfirm} onPress={confirmOtp} disabled={current.otpCode.length < 6} />
        ) : (
          <Button label={copy.cta} onPress={sendOtp} disabled={current.phone.length === 0} />
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
  const normalised = digits.startsWith('255') ? digits : digits.startsWith('0') ? `255${digits.slice(1)}` : `255${digits}`
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

const styles = StyleSheet.create({
  hint: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.sm
  }
})
