import { useState } from 'react'
import { useRouter } from 'expo-router'
import { useMutation } from '@tanstack/react-query'
import { StyleSheet, Text, View } from 'react-native'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { ProgressBar } from '@/components/ProgressBar'
import { useToast } from '@/components/Toast'
import { useTranslation } from '@/hooks/useTranslation'
import { useDebouncedSubmit } from '@/hooks/useDebouncedSubmit'
import { submitKyc } from '@/api/buyers'
import { initialKycState, stepOrder, stepTitleKey, type KycStepKey, type KycWizardState } from '@/kyc/state'
import { PersonalStep } from '@/kyc/steps/PersonalStep'
import { NidaStep } from '@/kyc/steps/NidaStep'
import { CompanyStep } from '@/kyc/steps/CompanyStep'
import { AmlStep } from '@/kyc/steps/AmlStep'
import { ReviewStep } from '@/kyc/steps/ReviewStep'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'

export default function KycWizard() {
  const router = useRouter()
  const { t } = useTranslation()
  const toast = useToast()
  const [stepIndex, setStepIndex] = useState(0)
  const [state, setState] = useState<KycWizardState>(initialKycState)

  const submitMutation = useMutation({
    mutationFn: submitKyc,
    onSuccess: (record) => {
      toast.show(t('kyc.submit_success'), 'success')
      router.push({ pathname: '/kyc/verify', params: { id: record.id } })
    },
    onError: () => toast.show(t('kyc.submit_failed'), 'error')
  })

  const currentStep: KycStepKey = stepOrder[stepIndex] ?? 'personal'
  const progress = (stepIndex + 1) / stepOrder.length

  // G4 — robustness 2026-05-29: belt-and-braces double-tap guard on
  // the KYC submit. `submitMutation.isPending` already disables the
  // button in flight; the 800ms debounce window catches a flaky-
  // network second tap before isPending flips.
  const handleSubmitKyc = useDebouncedSubmit(() => submitMutation.mutate(state))

  function goNext(): void {
    setStepIndex((prev) => Math.min(prev + 1, stepOrder.length - 1))
  }

  function goBack(): void {
    setStepIndex((prev) => Math.max(prev - 1, 0))
  }

  return (
    <Screen>
      <SectionHeader title={t('kyc.title')} subtitle={t('kyc.subtitle')} />

      <View style={styles.progress}>
        <Text style={styles.progressLabel}>
          {t('kyc.step_progress', { current: stepIndex + 1, total: stepOrder.length })}
        </Text>
        <ProgressBar value={progress} />
      </View>

      <Text style={styles.stepHeading}>{t(stepTitleKey[currentStep])}</Text>

      {currentStep === 'personal' ? (
        <PersonalStep
          initial={state.personal}
          onNext={(values) => {
            setState((prev) => ({ ...prev, personal: values }))
            goNext()
          }}
        />
      ) : null}

      {currentStep === 'nida' ? (
        <NidaStep
          initial={state.nida}
          onBack={goBack}
          onNext={(values) => {
            setState((prev) => ({ ...prev, nida: values }))
            goNext()
          }}
        />
      ) : null}

      {currentStep === 'company' ? (
        <CompanyStep
          initial={state.company}
          onBack={goBack}
          onNext={(values) => {
            setState((prev) => ({ ...prev, company: values }))
            goNext()
          }}
        />
      ) : null}

      {currentStep === 'aml' ? (
        <AmlStep
          initial={state.aml}
          onBack={goBack}
          onNext={(values) => {
            setState((prev) => ({ ...prev, aml: values }))
            goNext()
          }}
        />
      ) : null}

      {currentStep === 'review' ? (
        <ReviewStep
          state={state}
          onBack={goBack}
          submitting={submitMutation.isPending}
          onSubmit={handleSubmitKyc}
        />
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  progress: { marginBottom: spacing.md },
  progressLabel: { ...typography.micro, color: colors.inkMuted, textTransform: 'uppercase', marginBottom: spacing.xs },
  stepHeading: { ...typography.heading, color: colors.ink, marginBottom: spacing.md }
})
