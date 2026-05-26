import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { StyleSheet, Text, View } from 'react-native'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { Card } from '@/components/Card'
import { Pill, type PillTone } from '@/components/Pill'
import { Timeline } from '@/components/Timeline'
import { PrimaryButton } from '@/components/PrimaryButton'
import { useTranslation } from '@/hooks/useTranslation'
import { useSession } from '@/auth/session'
import { fetchKycStatus } from '@/api/buyers'
import { queryKeys } from '@/api/queryKeys'
import type { KycStage } from '@/types/kyc'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'

const stageOrder: readonly KycStage[] = ['submitted', 'reviewing', 'approved']

const toneByStage: Record<KycStage, PillTone> = {
  submitted: 'warning',
  reviewing: 'warning',
  approved: 'success',
  rejected: 'danger'
}

export default function KycVerify() {
  const router = useRouter()
  const { t } = useTranslation()
  const user = useSession()
  const params = useLocalSearchParams<{ id?: string }>()
  const id = String(params.id ?? `kyc-${user.id}`)

  const query = useQuery({
    queryKey: queryKeys.kycStatus(id),
    queryFn: () => fetchKycStatus(id),
    refetchInterval: (q) => {
      const record = q.state.data
      if (!record) {
        return 5_000
      }
      if (record.stage === 'approved' || record.stage === 'rejected') {
        return false
      }
      return 5_000
    }
  })

  const stage = query.data?.stage ?? 'submitted'
  const items = stageOrder.map((s) => ({
    id: s,
    title: t(`kyc.stage_${s}`),
    subtitle: stageIndex(s) <= stageIndex(stage) ? '✓' : '—'
  }))

  return (
    <Screen>
      <SectionHeader title={t('kyc.verify_title')} subtitle={`${user.companyName} · ${user.countryCode}`} />

      <Card>
        <View style={styles.row}>
          <Text style={styles.cardTitle}>{t(`kyc.stage_${stage}`)}</Text>
          <Pill label={t(`kyc.stage_${stage}`)} tone={toneByStage[stage]} />
        </View>
        <Timeline items={items} />
      </Card>

      {query.data?.rejectionReason ? (
        <Card>
          <Text style={styles.cardTitle}>{t('kyc.stage_rejected')}</Text>
          <Text style={styles.body}>{query.data.rejectionReason}</Text>
        </Card>
      ) : null}

      {stage === 'approved' ? (
        <View style={{ marginTop: spacing.md }}>
          <PrimaryButton
            label={t('kyc.continue_marketplace')}
            variant="primary"
            onPress={() => router.replace('/marketplace')}
          />
        </View>
      ) : null}
    </Screen>
  )
}

function stageIndex(stage: KycStage): number {
  return stageOrder.indexOf(stage)
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  cardTitle: { ...typography.heading, color: colors.ink },
  body: { ...typography.body, color: colors.inkSoft }
})
