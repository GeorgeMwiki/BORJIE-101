import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { DocumentExplorer } from '@/documents/DocumentExplorer'
import { listDocuments } from '@/documents/api'
import type { UploadedDocument } from '@/documents/types'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'

/**
 * /documents-intel/[id] — full-screen DocumentExplorer for a single
 * uploaded document on the buyer surface.
 */
export default function DocumentIntelDetail() {
  const params = useLocalSearchParams<{ id: string }>()
  const id = String(params.id)
  const [doc, setDoc] = useState<UploadedDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listDocuments(200)
      .then((docs) => {
        if (cancelled) return
        const found = docs.find((d) => d.id === id) ?? null
        setDoc(found)
        setError(found ? null : 'Document not found.')
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        const message = cause instanceof Error ? cause.message : 'Failed.'
        setError(message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.forest} />
      </View>
    )
  }
  if (!doc) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? 'Not found.'}</Text>
      </View>
    )
  }
  return <DocumentExplorer document={doc} />
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bone,
    padding: spacing.xl,
  },
  error: {
    color: '#9E2A2B',
    ...typography.body,
    textAlign: 'center',
  },
})
