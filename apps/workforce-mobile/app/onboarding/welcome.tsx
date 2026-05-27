import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { Button } from '../../src/forms/Button'
import { WizardShell } from '../../src/onboarding/WizardShell'
import { useOnboardingDraft } from '../../src/onboarding/state'
import { pickStrings } from '../../src/i18n'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

export default function WelcomeStep(): JSX.Element {
  const { current, update, markStepComplete } = useOnboardingDraft()
  const t = useMemo(() => pickStrings(current.lang), [current.lang])
  const copy = t.onboarding.welcome

  function pickLang(lang: 'sw' | 'en'): void {
    update({ lang })
  }

  function start(): void {
    markStepComplete('welcome')
    router.push('/onboarding/phone')
  }

  return (
    <WizardShell
      badge="BORJIE"
      title={copy.title}
      subtitle={copy.subtitle}
      footer={<Button label={copy.cta} onPress={start} />}
    >
      <View style={styles.brandCard}>
        <Text style={styles.brandTitle}>Borjie</Text>
        <Text style={styles.brandTagline}>{copy.tagline}</Text>
      </View>
      <Text style={styles.prompt}>{copy.langPrompt}</Text>
      <View style={styles.langRow}>
        <LangChip
          label={copy.swahili}
          selected={current.lang === 'sw'}
          onPress={() => pickLang('sw')}
        />
        <LangChip
          label={copy.english}
          selected={current.lang === 'en'}
          onPress={() => pickLang('en')}
        />
      </View>
    </WizardShell>
  )
}

interface LangChipProps {
  label: string
  selected: boolean
  onPress: () => void
}

function LangChip({ label, selected, onPress }: LangChipProps): JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected ? styles.chipSelected : null,
        pressed ? styles.chipPressed : null
      ]}
    >
      <Text style={[styles.chipLabel, selected ? styles.chipLabelSelected : null]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  brandCard: {
    alignItems: 'center',
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.earth700,
    marginBottom: spacing.xl
  },
  brandTitle: {
    color: colors.goldLight,
    fontSize: fontSize.h1,
    fontWeight: '700',
    letterSpacing: 2
  },
  brandTagline: {
    color: colors.textInverse,
    fontSize: fontSize.body,
    marginTop: spacing.sm
  },
  prompt: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600',
    marginBottom: spacing.sm
  },
  langRow: {
    flexDirection: 'row',
    gap: spacing.md
  },
  chip: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center'
  },
  chipSelected: {
    borderColor: colors.gold,
    backgroundColor: colors.earth100
  },
  chipPressed: {
    opacity: 0.85
  },
  chipLabel: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600'
  },
  chipLabelSelected: {
    color: colors.goldDark,
    fontWeight: '700'
  }
})
