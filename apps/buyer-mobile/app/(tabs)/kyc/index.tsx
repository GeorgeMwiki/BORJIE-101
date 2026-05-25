import { useRouter } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { Card } from '@/components/Card'
import { PrimaryButton } from '@/components/PrimaryButton'
import { useTranslation } from '@/hooks/useTranslation'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'

interface Step {
  readonly key: string
  readonly hint: string
}

const steps: readonly Step[] = [
  { key: 'kyc.step_nida', hint: 'NIDA · National ID front/back + selfie' },
  { key: 'kyc.step_tin', hint: 'TIN certificate from TRA' },
  { key: 'kyc.step_company', hint: 'Memorandum, BRELA certificate' },
  { key: 'kyc.step_aml', hint: 'AML / source-of-funds declaration' }
] as const

export default function KycIndex() {
  const router = useRouter()
  const { t } = useTranslation()

  return (
    <Screen>
      <SectionHeader title={t('kyc.title')} subtitle={t('kyc.subtitle')} />

      {steps.map((step, idx) => (
        <Card key={step.key}>
          <View style={styles.stepRow}>
            <View style={styles.stepIndex}>
              <Text style={styles.stepIndexLabel}>{idx + 1}</Text>
            </View>
            <View style={styles.stepBody}>
              <Text style={styles.stepTitle}>{t(step.key)}</Text>
              <Text style={styles.stepHint}>{step.hint}</Text>
            </View>
          </View>
        </Card>
      ))}

      <View style={{ marginTop: spacing.lg }}>
        <PrimaryButton label={t('kyc.submit')} variant="primary" onPress={() => router.push('/kyc/verify')} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  stepRow: { flexDirection: 'row', alignItems: 'center' },
  stepIndex: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.forest,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md
  },
  stepIndexLabel: { ...typography.bodyStrong, color: colors.bone },
  stepBody: { flex: 1 },
  stepTitle: { ...typography.bodyStrong, color: colors.ink },
  stepHint: { ...typography.caption, color: colors.inkMuted, marginTop: 2 }
})
