import { StyleSheet, Text, View } from 'react-native'
import { Card } from '@/components/Card'
import { KeyValueRow } from '@/components/KeyValueRow'
import { PrimaryButton } from '@/components/PrimaryButton'
import { useTranslation } from '@/hooks/useTranslation'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'
import type { KycWizardState } from '@/kyc/state'

export interface ReviewStepProps {
  readonly state: KycWizardState
  readonly onSubmit: () => void
  readonly onBack: () => void
  readonly submitting: boolean
}

export function ReviewStep({ state, onSubmit, onBack, submitting }: ReviewStepProps) {
  const { t } = useTranslation()
  return (
    <View>
      <Text style={styles.intro}>{t('kyc.review_intro')}</Text>

      <Card>
        <Text style={styles.cardTitle}>{t('kyc.step_personal')}</Text>
        <KeyValueRow label={t('kyc.full_name')} value={state.personal.fullName || '—'} />
        <KeyValueRow label={t('kyc.phone')} value={state.personal.phone || '—'} />
        <KeyValueRow label={t('kyc.email')} value={state.personal.email || '—'} />
      </Card>

      <Card>
        <Text style={styles.cardTitle}>{t('kyc.step_nida')}</Text>
        <KeyValueRow label={t('kyc.nida_front')} value={state.nida.frontImageUri ? 'OK' : '—'} />
        <KeyValueRow label={t('kyc.nida_back')} value={state.nida.backImageUri ? 'OK' : '—'} />
      </Card>

      <Card>
        <Text style={styles.cardTitle}>{t('kyc.step_company')}</Text>
        <KeyValueRow label={t('kyc.tin')} value={state.company.tin || '—'} />
        <KeyValueRow label={t('kyc.registration_doc')} value={state.company.registrationDocName || '—'} />
      </Card>

      <Card>
        <Text style={styles.cardTitle}>{t('kyc.step_aml')}</Text>
        <KeyValueRow label={t('kyc.source_of_funds')} value={state.aml.sourceOfFunds || '—'} />
        <KeyValueRow label={t('kyc.pep_label')} value={state.aml.isPep ? t('common.yes') : t('common.no')} />
        <KeyValueRow
          label={t('kyc.sanctions_consent')}
          value={state.aml.sanctionsConsent ? t('common.yes') : t('common.no')}
        />
      </Card>

      <View style={styles.actions}>
        <View style={styles.flex}>
          <PrimaryButton label={t('kyc.back')} variant="ghost" onPress={onBack} />
        </View>
        <View style={styles.spacer} />
        <View style={styles.flex}>
          <PrimaryButton label={t('kyc.submit')} variant="primary" onPress={onSubmit} disabled={submitting} />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  intro: { ...typography.body, color: colors.inkSoft, marginBottom: spacing.md },
  cardTitle: { ...typography.heading, color: colors.ink, marginBottom: spacing.sm },
  actions: { flexDirection: 'row', marginTop: spacing.md, marginBottom: spacing.xxl },
  flex: { flex: 1 },
  spacer: { width: spacing.md }
})
