import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { Button } from '../../src/forms/Button'
import { Field } from '../../src/forms/Field'
import { FingerprintPlaceholder } from '../../src/components/FingerprintPlaceholder'
import { WizardShell } from '../../src/onboarding/WizardShell'
import { useOnboardingDraft } from '../../src/onboarding/state'
import { pickStrings } from '../../src/i18n'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

export default function BiometricStep(): JSX.Element {
  const { current, update, markStepComplete } = useOnboardingDraft()
  const t = useMemo(() => pickStrings(current.lang), [current.lang])
  const copy = t.onboarding.biometric

  const [pinError, setPinError] = useState<string | null>(null)

  function enroll(): void {
    update({ biometricEnrolled: true })
  }

  function next(): void {
    markStepComplete('biometric')
    router.push('/onboarding/safety')
  }

  function skip(): void {
    if (current.pinFallback.length !== 4) {
      setPinError(t.common.required)
      return
    }
    markStepComplete('biometric')
    router.push('/onboarding/safety')
  }

  const enrolled = current.biometricEnrolled

  return (
    <WizardShell
      badge="BIO"
      title={copy.title}
      subtitle={copy.subtitle}
      footer={
        enrolled ? (
          <Button label={t.common.next} onPress={next} />
        ) : (
          <View style={styles.footerCol}>
            <Button label={copy.cta} onPress={enroll} />
            <Button label={copy.skip} variant="ghost" onPress={skip} />
          </View>
        )
      }
    >
      <View style={styles.padBlock}>
        <FingerprintPlaceholder label={enrolled ? copy.enrolled : copy.tapToScan} onSign={enroll} />
        {enrolled ? (
          <View style={styles.successPill}>
            <Text style={styles.successText}>{copy.enrolled}</Text>
          </View>
        ) : null}
      </View>
      {!enrolled ? (
        <View style={styles.pinBlock}>
          <Text style={styles.pinHeader}>{copy.pinFallbackHeader}</Text>
          <Field
            label={copy.pinFallbackLabel}
            value={current.pinFallback}
            onChangeText={(value) => {
              setPinError(null)
              update({ pinFallback: value.replace(/[^0-9]/g, '').slice(0, 4) })
            }}
            placeholder={copy.pinFallbackPlaceholder}
            keyboardType="number-pad"
            error={pinError}
          />
        </View>
      ) : null}
    </WizardShell>
  )
}

const styles = StyleSheet.create({
  padBlock: {
    alignItems: 'center',
    marginBottom: spacing.lg
  },
  successPill: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.success,
    borderRadius: radius.pill
  },
  successText: {
    color: colors.textInverse,
    fontSize: fontSize.caption,
    fontWeight: '700'
  },
  pinBlock: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.earth100
  },
  pinHeader: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '700',
    marginBottom: spacing.sm
  },
  footerCol: {
    gap: spacing.sm
  }
})
