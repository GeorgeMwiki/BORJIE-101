import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { DocumentList } from '@/documents/DocumentList'
import { DocumentUploadButton } from '@/documents/DocumentUploadButton'
import { listDocuments } from '@/documents/api'
import type { UploadedDocument } from '@/documents/types'
import { useTranslation } from '@/hooks/useTranslation'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'

/**
 * B-DOC-INTEL-01 — Buyer Documents Intelligence tab.
 *
 * Lists every document the buyer has uploaded — counterparty contracts,
 * RFPs, letters. Tapping a row navigates to the DocumentExplorer route.
 * The upload CTA is the canonical DocumentUploadButton — the same
 * component the chat composer uses as a paperclip.
 */
export default function DocumentsIntelTab() {
  const router = useRouter()
  const { t } = useTranslation()
  const [docs, setDocs] = useState<ReadonlyArray<UploadedDocument>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await listDocuments(50)
      setDocs(next)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t('documents_intel.load_failed')
      setError(message)
      setDocs([])
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <Screen>
      <SectionHeader
        title={t('documents_intel.tab_title')}
        subtitle={t('documents_intel.tab_subtitle')}
      />
      <View style={styles.uploadRow}>
        <DocumentUploadButton
          label={t('documents_intel.upload_new')}
          onUploaded={(result) => setDocs((prev) => [result.document, ...prev])}
          onError={(message) => setError(message)}
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator color={colors.forest} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.listContent}>
          <DocumentList
            documents={docs}
            onSelect={(doc) =>
              router.push({ pathname: '/documents-intel/[id]', params: { id: doc.id } })
            }
          />
        </ScrollView>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  uploadRow: {
    paddingVertical: spacing.sm,
  },
  error: {
    backgroundColor: '#F4D7D7',
    color: '#9E2A2B',
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginVertical: spacing.sm,
    ...typography.caption,
  },
  loader: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  listContent: {
    paddingVertical: spacing.sm,
  },
})
