import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { Button } from '../../src/forms/Button'
import { FingerprintPlaceholder } from '../../src/components/FingerprintPlaceholder'
import { WizardShell } from '../../src/onboarding/WizardShell'
import { useOnboardingDraft } from '../../src/onboarding/state'
import { pickStrings } from '../../src/i18n'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SAFETY_TOPIC_KEYS = ['topicPpe', 'topicEscape', 'topicNearMiss', 'topicFire', 'topicChain'] as const
type SafetyTopicKey = (typeof SAFETY_TOPIC_KEYS)[number]

export default function SafetyStep(): JSX.Element {
  const { current, update, markStepComplete } = useOnboardingDraft()
  const t = useMemo(() => pickStrings(current.lang), [current.lang])
  const copy = t.onboarding.safety

  const [signError, setSignError] = useState<string | null>(null)

  function toggle(topic: SafetyTopicKey): void {
    const exists = current.safetyAcknowledgedTopics.includes(topic)
    const nextList = exists
      ? current.safetyAcknowledgedTopics.filter((k) => k !== topic)
      : [...current.safetyAcknowledgedTopics, topic]
    update({ safetyAcknowledgedTopics: nextList })
  }

  function sign(): void {
    if (current.safetyAcknowledgedTopics.length < SAFETY_TOPIC_KEYS.length) {
      setSignError(copy.blockedHint)
      return
    }
    update({ safetySignedOff: true })
    markStepComplete('safety')
    router.push('/onboarding/calibration')
  }

  const allAcked = current.safetyAcknowledgedTopics.length === SAFETY_TOPIC_KEYS.length

  return (
    <WizardShell
      badge="OSHA-TZ"
      title={copy.title}
      subtitle={copy.subtitle}
      footer={
        <Button label={copy.cta} onPress={sign} disabled={!allAcked} />
      }
    >
      <Text style={styles.hint}>{copy.ackHint}</Text>
      <View style={styles.list}>
        {SAFETY_TOPIC_KEYS.map((key) => {
          const acked = current.safetyAcknowledgedTopics.includes(key)
          return (
            <Pressable
              key={key}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: acked }}
              onPress={() => toggle(key)}
              style={({ pressed }) => [
                styles.row,
                acked ? styles.rowAcked : null,
                pressed ? styles.rowPressed : null
              ]}
            >
              <View style={[styles.checkbox, acked ? styles.checkboxChecked : null]}>
                {acked ? <Text style={styles.checkmark}>{'✓'}</Text> : null}
              </View>
              <Text style={[styles.rowLabel, acked ? styles.rowLabelAcked : null]}>{copy[key]}</Text>
            </Pressable>
          )
        })}
      </View>
      <View style={styles.fpBlock}>
        <Text style={styles.fpLabel}>{copy.fingerprintLabel}</Text>
        {allAcked ? (
          <FingerprintPlaceholder label={copy.signedOff} onSign={sign} />
        ) : (
          <FingerprintPlaceholder label={copy.blockedHint} />
        )}
        {signError ? <Text style={styles.error}>{signError}</Text> : null}
      </View>
    </WizardShell>
  )
}

const styles = StyleSheet.create({
  hint: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginBottom: spacing.md
  },
  list: {
    marginBottom: spacing.lg
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    marginBottom: spacing.sm
  },
  rowAcked: {
    backgroundColor: colors.earth100,
    borderColor: colors.success
  },
  rowPressed: {
    opacity: 0.85
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.earth500,
    marginRight: spacing.md,
    alignItems: 'center',
    justifyContent: 'center'
  },
  checkboxChecked: {
    borderColor: colors.success,
    backgroundColor: colors.success
  },
  checkmark: {
    color: colors.textInverse,
    fontSize: fontSize.body,
    fontWeight: '700'
  },
  rowLabel: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600'
  },
  rowLabelAcked: {
    color: colors.earth900
  },
  fpBlock: {
    marginTop: spacing.md,
    alignItems: 'center'
  },
  fpLabel: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '700',
    marginBottom: spacing.sm
  },
  error: {
    marginTop: spacing.sm,
    color: colors.danger,
    fontSize: fontSize.caption,
    fontWeight: '600'
  }
})
