import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { DocumentList } from '../../../src/documents/DocumentList'
import { DocumentUploadButton } from '../../../src/documents/DocumentUploadButton'
import { listDocuments } from '../../../src/documents/api'
import type { UploadedDocument } from '../../../src/documents/types'
import { ScreenShell } from '../../../src/components/ScreenShell'
import { Section } from '../../../src/components/Section'
import { colors } from '../../../src/theme/colors'
import { fontSize, spacing } from '../../../src/theme/spacing'

/**
 * W-DOC-INTEL-01 — Documents tab (workforce-mobile).
 *
 * Lists every document the worker / owner / manager has uploaded across
 * sessions, with kind + ingestion-status chips. Tapping a row navigates
 * to /documents/<id> which renders the DocumentExplorer (live chat +
 * preview).
 *
 * The paperclip CTA above the list opens expo-document-picker; the same
 * DocumentUploadButton is composed by the chat composer (CH-* surfaces)
 * as the chat-level paperclip.
 */
export default function DocumentsTab(): JSX.Element {
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
      const message = cause instanceof Error ? cause.message : 'Imeshindikana kupakia hati.'
      setError(message)
      setDocs([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <ScreenShell screenId="W-DOC-INTEL-01">
      <Section title="Hati hai">
        <View style={styles.uploadRow}>
          <DocumentUploadButton
            label="Pakia hati mpya"
            onUploaded={(result) => {
              setDocs((prev) => [result.document, ...prev])
            }}
            onError={(message) => setError(message)}
          />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? (
          <View style={styles.loader}>
            <ActivityIndicator color={colors.goldDark} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.listContent}>
            <DocumentList
              documents={docs}
              onSelect={(doc) =>
                router.push({ pathname: '/documents/[id]', params: { id: doc.id } })
              }
            />
          </ScrollView>
        )}
      </Section>
    </ScreenShell>
  )
}

const styles = StyleSheet.create({
  uploadRow: {
    paddingVertical: spacing.sm,
  },
  error: {
    backgroundColor: '#F4D7D7',
    color: colors.danger,
    padding: spacing.sm,
    borderRadius: 6,
    marginVertical: spacing.sm,
    fontSize: fontSize.caption,
  },
  loader: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  listContent: {
    paddingVertical: spacing.sm,
  },
})
