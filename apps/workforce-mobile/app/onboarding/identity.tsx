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

export default function IdentityStep(): JSX.Element {
  const { current, update, markStepComplete } = useOnboardingDraft()
  const t = useMemo(() => pickStrings(current.lang), [current.lang])
  const copy = t.onboarding.identity

  const [nameError, setNameError] = useState<string | null>(null)
  const [dobError, setDobError] = useState<string | null>(null)

  function next(): void {
    let valid = true
    if (current.fullName.trim().length < 2) {
      setNameError(t.common.required)
      valid = false
    }
    if (current.dob.trim().length < 4) {
      setDobError(t.common.required)
      valid = false
    }
    if (!valid) return
    markStepComplete('identity')
    router.push('/onboarding/role-detect')
  }

  return (
    <WizardShell
      badge="ID"
      title={copy.title}
      subtitle={copy.subtitle}
      footer={<Button label={copy.cta} onPress={next} />}
    >
      <Field
        label={copy.fullNameLabel}
        value={current.fullName}
        onChangeText={(value) => {
          setNameError(null)
          update({ fullName: value })
        }}
        placeholder={copy.fullNamePlaceholder}
        autoCapitalize="words"
        error={nameError}
      />
      <Field
        label={copy.dobLabel}
        value={current.dob}
        onChangeText={(value) => {
          setDobError(null)
          update({ dob: value })
        }}
        placeholder={copy.dobPlaceholder}
        keyboardType="numbers-and-punctuation"
        error={dobError}
      />
      <View style={styles.optionalBlock}>
        <Field
          label={copy.nidaLabel}
          value={current.nidaNumber}
          onChangeText={(value) => update({ nidaNumber: value.replace(/[^0-9]/g, '').slice(0, 20) })}
          placeholder={copy.nidaPlaceholder}
          keyboardType="number-pad"
        />
        <Text style={styles.hint}>{copy.nidaHint}</Text>
      </View>
    </WizardShell>
  )
}

const styles = StyleSheet.create({
  optionalBlock: {
    marginTop: spacing.md
  },
  hint: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  }
})
