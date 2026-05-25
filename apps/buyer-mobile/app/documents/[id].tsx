import { useLocalSearchParams } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { Card } from '@/components/Card'
import { KeyValueRow } from '@/components/KeyValueRow'
import { Pill } from '@/components/Pill'
import { PrimaryButton } from '@/components/PrimaryButton'
import { EmptyState } from '@/components/EmptyState'
import { PdfViewer } from '@/components/PdfViewer'
import { useToast } from '@/components/Toast'
import { useTranslation } from '@/hooks/useTranslation'
import { authenticateForSignature } from '@/auth/biometric'
import { fetchDocument, signDocument } from '@/api/documents'
import { queryKeys } from '@/api/queryKeys'
import { formatDate, formatTzs } from '@/components/formatters'
import { colors } from '@/theme/colors'
import { spacing } from '@/theme/spacing'

export default function DocumentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const docId = String(id)

  const query = useQuery({
    queryKey: queryKeys.document(docId),
    queryFn: () => fetchDocument(docId)
  })

  const signMutation = useMutation({
    mutationFn: signDocument,
    onSuccess: async (doc) => {
      if (doc) {
        queryClient.setQueryData(queryKeys.document(docId), doc)
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.documents() })
      toast.show(t('documents.sign_success'), 'success')
    },
    onError: () => toast.show(t('documents.sign_failed'), 'error')
  })

  if (query.isLoading) {
    return (
      <Screen>
        <View style={styles.loader}>
          <ActivityIndicator color={colors.forest} />
        </View>
      </Screen>
    )
  }

  const doc = query.data
  if (!doc) {
    return (
      <Screen>
        <EmptyState message={t('documents.empty_pending')} />
      </Screen>
    )
  }

  const isPending = doc.status === 'pending_signature'

  async function handleSign(): Promise<void> {
    const bio = await authenticateForSignature(t('documents.sign_biometric'))
    if (!bio.ok) {
      const map = {
        unavailable: 'documents.biometric_unavailable',
        not_enrolled: 'documents.biometric_not_enrolled',
        cancelled: 'documents.biometric_cancelled',
        failed: 'documents.sign_failed'
      } as const
      toast.show(t(map[bio.reason]), bio.reason === 'cancelled' ? 'info' : 'error')
      return
    }
    signMutation.mutate({ documentId: docId, biometricToken: bio.token })
  }

  return (
    <Screen>
      <SectionHeader title={doc.title} subtitle={doc.counterparty} />

      <Card>
        <PdfViewer url={doc.pdfUrl} title={t('documents.view_pdf')} />
      </Card>

      <Card>
        <KeyValueRow label={t('documents.total')} value={formatTzs(doc.totalTzs)} />
        <KeyValueRow label="Issued" value={formatDate(doc.issuedAt)} />
        {doc.signedAt ? <KeyValueRow label={t('documents.signed_at')} value={formatDate(doc.signedAt)} /> : null}
        <View style={{ marginTop: spacing.sm }}>
          <Pill
            label={isPending ? t('documents.pending') : t('documents.signed')}
            tone={isPending ? 'warning' : 'success'}
          />
        </View>
      </Card>

      {isPending ? (
        <View style={{ marginTop: spacing.md }}>
          <PrimaryButton
            label={t('documents.sign_biometric')}
            variant="gold"
            onPress={handleSign}
            disabled={signMutation.isPending}
          />
        </View>
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  loader: { paddingVertical: spacing.xxl, alignItems: 'center' }
})
