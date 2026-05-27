import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { Button } from '../../src/forms/Button'
import { WizardShell } from '../../src/onboarding/WizardShell'
import { useOnboardingDraft } from '../../src/onboarding/state'
import { calibrateAiTone } from '../../src/onboarding/intelligence'
import type { AiTone } from '../../src/onboarding/state'
import { pickStrings } from '../../src/i18n'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SLIDER_STEPS = [0, 0.5, 1] as const
type SliderValue = (typeof SLIDER_STEPS)[number]

interface SliderRowProps {
  label: string
  lowLabel: string
  highLabel: string
  value: number
  onChange: (next: SliderValue) => void
}

function SliderRow({ label, lowLabel, highLabel, value, onChange }: SliderRowProps): JSX.Element {
  return (
    <View style={styles.sliderBlock}>
      <Text style={styles.sliderTitle}>{label}</Text>
      <View style={styles.sliderRow}>
        {SLIDER_STEPS.map((step, idx) => {
          const selected = value === step
          const cornerLabel = idx === 0 ? lowLabel : idx === SLIDER_STEPS.length - 1 ? highLabel : '·'
          return (
            <Pressable
              key={step}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onChange(step)}
              style={({ pressed }) => [
                styles.sliderCell,
                selected ? styles.sliderCellSelected : null,
                pressed ? styles.sliderCellPressed : null
              ]}
            >
              <Text style={[styles.sliderLabel, selected ? styles.sliderLabelSelected : null]}>
                {cornerLabel}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

export default function CalibrationStep(): JSX.Element {
  const { current, update, markStepComplete } = useOnboardingDraft()
  const t = useMemo(() => pickStrings(current.lang), [current.lang])
  const copy = t.onboarding.calibration

  const tone = useMemo(() => calibrateAiTone(current.toneSliders), [current.toneSliders])

  function setSlider(key: 'formality' | 'brevity' | 'humor', next: SliderValue): void {
    const nextSliders = { ...current.toneSliders, [key]: next }
    update({ toneSliders: nextSliders, aiTone: calibrateAiTone(nextSliders) })
  }

  function next(): void {
    update({ aiTone: tone })
    markStepComplete('calibration')
    router.push('/onboarding/done')
  }

  return (
    <WizardShell
      badge="TONE"
      title={copy.title}
      subtitle={copy.subtitle}
      footer={<Button label={copy.cta} onPress={next} />}
    >
      <SliderRow
        label={copy.formalityLabel}
        lowLabel={copy.formalityLow}
        highLabel={copy.formalityHigh}
        value={current.toneSliders.formality}
        onChange={(v) => setSlider('formality', v)}
      />
      <SliderRow
        label={copy.brevityLabel}
        lowLabel={copy.brevityLow}
        highLabel={copy.brevityHigh}
        value={current.toneSliders.brevity}
        onChange={(v) => setSlider('brevity', v)}
      />
      <SliderRow
        label={copy.humorLabel}
        lowLabel={copy.humorLow}
        highLabel={copy.humorHigh}
        value={current.toneSliders.humor}
        onChange={(v) => setSlider('humor', v)}
      />
      <View style={styles.previewCard}>
        <Text style={styles.previewHeader}>{copy.previewHeader}</Text>
        <Text style={styles.previewBody}>{toneSample(tone, copy)}</Text>
      </View>
    </WizardShell>
  )
}

function toneSample(tone: AiTone, copy: ReturnType<typeof pickStrings>['onboarding']['calibration']): string {
  switch (tone) {
    case 'formal':
      return copy.sampleFormal
    case 'brief':
      return copy.sampleBrief
    case 'with-jokes':
      return copy.sampleWithJokes
    case 'friendly':
    default:
      return copy.sampleFriendly
  }
}

const styles = StyleSheet.create({
  sliderBlock: {
    marginBottom: spacing.lg
  },
  sliderTitle: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '700',
    marginBottom: spacing.sm
  },
  sliderRow: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  sliderCell: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center'
  },
  sliderCellSelected: {
    borderColor: colors.gold,
    backgroundColor: colors.earth100
  },
  sliderCellPressed: {
    opacity: 0.85
  },
  sliderLabel: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '600',
    textAlign: 'center'
  },
  sliderLabelSelected: {
    color: colors.goldDark,
    fontWeight: '700'
  },
  previewCard: {
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.earth700
  },
  previewHeader: {
    color: colors.goldLight,
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: spacing.xs
  },
  previewBody: {
    color: colors.textInverse,
    fontSize: fontSize.lead
  }
})
