import { useLocalSearchParams } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { Card } from '@/components/Card'
import { KeyValueRow } from '@/components/KeyValueRow'
import { Pill } from '@/components/Pill'
import { PrimaryButton } from '@/components/PrimaryButton'
import { EmptyState } from '@/components/EmptyState'
import { useTranslation } from '@/hooks/useTranslation'
import { findDocument } from '@/mocks/documents'
import { formatDate, formatTzs } from '@/components/formatters'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'

export default function DocumentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { t } = useTranslation()
  const doc = findDocument(String(id))

  if (!doc) {
    return (
      <Screen>
        <EmptyState message="—" />
      </Screen>
    )
  }

  const isPending = doc.status === 'pending_signature'

  return (
    <Screen>
      <SectionHeader title={doc.title} subtitle={doc.counterparty} />

      <Card>
        <View style={styles.pdfPlaceholder}>
          <Text style={styles.pdfLabel}>PDF</Text>
          <Text style={styles.pdfHint}>{doc.pdfUrl}</Text>
        </View>
        <PrimaryButton label={t('documents.view_pdf')} variant="ghost" onPress={() => undefined} />
      </Card>

      <Card>
        <KeyValueRow label={t('documents.total')} value={formatTzs(doc.totalTzs)} />
        <KeyValueRow label="Issued" value={formatDate(doc.issuedAt)} />
        {doc.signedAt ? <KeyValueRow label={t('documents.signed_at')} value={formatDate(doc.signedAt)} /> : null}
        <View style={{ marginTop: spacing.sm }}>
          <Pill label={isPending ? t('documents.pending') : t('documents.signed')} tone={isPending ? 'warning' : 'success'} />
        </View>
      </Card>

      {isPending ? (
        <View style={{ marginTop: spacing.md }}>
          <PrimaryButton label={t('documents.sign_biometric')} variant="gold" onPress={() => undefined} />
        </View>
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  pdfPlaceholder: {
    height: 200,
    borderRadius: radius.md,
    backgroundColor: colors.sand,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md
  },
  pdfLabel: { ...typography.display, color: colors.earth },
  pdfHint: { ...typography.caption, color: colors.inkMuted, marginTop: spacing.xs }
})
