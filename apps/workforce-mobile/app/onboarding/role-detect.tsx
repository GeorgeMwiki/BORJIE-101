import { useMemo, useState } from 'react'
import { router } from 'expo-router'
import { Button } from '../../src/forms/Button'
import { Field } from '../../src/forms/Field'
import { WizardShell } from '../../src/onboarding/WizardShell'
import { useOnboardingDraft } from '../../src/onboarding/state'
import { classifyRole, type RoleClassification } from '../../src/onboarding/intelligence'
import { RoleGuessCard } from '../../src/onboarding/RoleGuessCard'
import { ManualRolePicker } from '../../src/onboarding/ManualRolePicker'
import { pickStrings } from '../../src/i18n'
import type { Role } from '../../src/roles/types'

const LOW_CONFIDENCE_THRESHOLD = 0.45

/**
 * Intelligent role detection. Today: deterministic keyword scoring via
 * `classifyRole`. Tomorrow: same interface, LLM-backed implementation in
 * `@borjie/brain-llm-router` — the call site here will not change.
 */
export default function RoleDetectStep(): JSX.Element {
  const { current, update, markStepComplete } = useOnboardingDraft()
  const t = useMemo(() => pickStrings(current.lang), [current.lang])
  const copy = t.onboarding.roleDetect

  const [classification, setClassification] = useState<RoleClassification | null>(null)
  const [manualMode, setManualMode] = useState<boolean>(false)

  function runClassifier(): void {
    const result = classifyRole(current.roleHint, current.lang)
    setClassification(result)
    update({ role: result.role, roleConfidence: result.confidence })
    if (result.confidence < LOW_CONFIDENCE_THRESHOLD) {
      setManualMode(true)
    }
  }

  function pickRole(role: Role): void {
    update({ role, roleConfidence: 1 })
    setClassification({ role, confidence: 1, matchedKeywords: ['manual-override'] })
    setManualMode(false)
  }

  function confirm(): void {
    if (!current.role) return
    markStepComplete('role-detect')
    router.push('/onboarding/site')
  }

  const showGuess = classification !== null && !manualMode
  const lowConfidence = classification !== null && classification.confidence < LOW_CONFIDENCE_THRESHOLD

  return (
    <WizardShell
      badge="AI"
      title={copy.title}
      subtitle={copy.subtitle}
      footer={
        showGuess ? (
          <Button label={copy.confirmCta} onPress={confirm} disabled={!current.role} />
        ) : manualMode ? (
          <Button label={copy.confirmCta} onPress={confirm} disabled={!current.role} />
        ) : (
          <Button label={copy.cta} onPress={runClassifier} disabled={current.roleHint.trim().length === 0} />
        )
      }
    >
      <Field
        label={copy.promptLabel}
        value={current.roleHint}
        onChangeText={(value) => update({ roleHint: value })}
        placeholder={copy.promptPlaceholder}
        multiline
      />
      {showGuess && classification ? (
        <RoleGuessCard
          classification={classification}
          roleLabel={roleLabel(classification.role, copy)}
          copy={copy}
          lowConfidence={lowConfidence}
          onOverride={() => setManualMode(true)}
        />
      ) : null}
      {manualMode ? (
        <ManualRolePicker selected={current.role} copy={copy} onPick={pickRole} />
      ) : null}
    </WizardShell>
  )
}

function roleLabel(role: Role, copy: ReturnType<typeof pickStrings>['onboarding']['roleDetect']): string {
  switch (role) {
    case 'owner':
      return copy.manualOwner
    case 'manager':
      return copy.manualManager
    case 'employee':
      return copy.manualEmployee
    default:
      return role
  }
}
