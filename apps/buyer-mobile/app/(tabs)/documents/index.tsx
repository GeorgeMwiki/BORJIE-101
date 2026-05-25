import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { Card } from '@/components/Card'
import { Pill } from '@/components/Pill'
import { EmptyState } from '@/components/EmptyState'
import { useTranslation } from '@/hooks/useTranslation'
import { fetchDocuments } from '@/api/documents'
import { queryKeys } from '@/api/queryKeys'
import { formatDate, formatTzs } from '@/components/formatters'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'

export default function DocumentsIndex() {
  const router = useRouter()
  const { t } = useTranslation()
  const query = useQuery({ queryKey: queryKeys.documents(), queryFn: fetchDocuments })

  if (query.isLoading) {
    return (
      <Screen>
        <SectionHeader title={t('documents.title')} />
        <View style={styles.loader}>
          <ActivityIndicator color={colors.forest} />
        </View>
      </Screen>
    )
  }

  const documents = query.data ?? []
  const pending = documents.filter((d) => d.status === 'pending_signature')
  const signed = documents.filter((d) => d.status === 'signed')

  return (
    <Screen>
      <SectionHeader title={t('documents.title')} />

      <Text style={styles.section}>{t('documents.pending')}</Text>
      {pending.length === 0 ? (
        <EmptyState message={t('documents.empty_pending')} />
      ) : (
        pending.map((doc) => (
          <Card key={doc.id} onPress={() => router.push(`/documents/${doc.id}`)}>
            <View style={styles.row}>
              <Text style={styles.title}>{doc.title}</Text>
              <Pill label={t('documents.pending')} tone="warning" />
            </View>
            <Text style={styles.meta}>
              {doc.counterparty} · {formatDate(doc.issuedAt)}
            </Text>
            <Text style={styles.amount}>{formatTzs(doc.totalTzs)}</Text>
          </Card>
        ))
      )}

      <Text style={styles.section}>{t('documents.signed')}</Text>
      {signed.length === 0 ? (
        <EmptyState message={t('documents.empty_signed')} />
      ) : (
        signed.map((doc) => (
          <Card key={doc.id} onPress={() => router.push(`/documents/${doc.id}`)}>
            <View style={styles.row}>
              <Text style={styles.title}>{doc.title}</Text>
              <Pill label={t('documents.signed')} tone="success" />
            </View>
            <Text style={styles.meta}>
              {doc.counterparty} · {t('documents.signed_at')} {doc.signedAt ? formatDate(doc.signedAt) : ''}
            </Text>
          </Card>
        ))
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...typography.heading, color: colors.ink, flexShrink: 1, paddingRight: spacing.sm },
  meta: { ...typography.caption, color: colors.inkMuted, marginTop: spacing.xs },
  amount: { ...typography.bodyStrong, color: colors.forest, marginTop: spacing.sm },
  section: {
    ...typography.micro,
    color: colors.inkMuted,
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: spacing.sm
  },
  loader: { paddingVertical: spacing.xxl, alignItems: 'center' }
})
