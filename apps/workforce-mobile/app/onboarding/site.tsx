import { useMemo, useState } from 'react'
import { router } from 'expo-router'
import { Button } from '../../src/forms/Button'
import { Field } from '../../src/forms/Field'
import { WizardShell } from '../../src/onboarding/WizardShell'
import { useOnboardingDraft } from '../../src/onboarding/state'
import { pickStrings } from '../../src/i18n'

/**
 * Adaptive site step. Owner → PML number (Tanzanian Primary Mining License).
 * Manager/Employee → site code of the mine they work at.
 */
export default function SiteStep(): JSX.Element {
  const { current, update, markStepComplete } = useOnboardingDraft()
  const t = useMemo(() => pickStrings(current.lang), [current.lang])
  const copy = t.onboarding.site
  const isOwner = current.role === 'owner'

  const [error, setError] = useState<string | null>(null)

  function next(): void {
    const value = isOwner ? current.pmlNumber : current.siteCode
    if (value.trim().length < 3) {
      setError(t.common.required)
      return
    }
    markStepComplete('site')
    if (current.role === 'employee' || current.role === 'manager') {
      router.push('/onboarding/certifications')
      return
    }
    router.push('/onboarding/biometric')
  }

  return (
    <WizardShell
      badge={isOwner ? 'PML' : 'SITE'}
      title={copy.title}
      subtitle={isOwner ? copy.subtitleOwner : copy.subtitleWorker}
      footer={<Button label={copy.cta} onPress={next} />}
    >
      {isOwner ? (
        <Field
          label={copy.pmlLabel}
          value={current.pmlNumber}
          onChangeText={(value) => {
            setError(null)
            update({ pmlNumber: value.toUpperCase() })
          }}
          placeholder={copy.pmlPlaceholder}
          autoCapitalize="characters"
          error={error}
        />
      ) : (
        <Field
          label={copy.siteCodeLabel}
          value={current.siteCode}
          onChangeText={(value) => {
            setError(null)
            update({ siteCode: value.toUpperCase() })
          }}
          placeholder={copy.siteCodePlaceholder}
          autoCapitalize="characters"
          error={error}
        />
      )}
    </WizardShell>
  )
}
