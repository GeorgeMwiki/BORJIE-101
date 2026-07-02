import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { DocumentExplorer } from '../../src/documents/DocumentExplorer'
import { listDocuments } from '../../src/documents/api'
import type { UploadedDocument } from '../../src/documents/types'
import { useI18n } from '../../src/i18n/useI18n'
import { colors } from '../../src/theme/colors'
import { fontSize, spacing } from '../../src/theme/spacing'

/**
 * /documents/[id] — full-screen DocumentExplorer for a single uploaded
 * document. Fetches the doc lazily from the tenant-scoped list (no
 * separate get-by-id endpoint yet; the list is small enough that a
 * client-side find is cheap).
 */
export default function DocumentDetailScreen(): JSX.Element {
  const { t } = useI18n()
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
        setError(found ? null : t.documentsTab.notFound)
      })
      .catch(() => {
        if (cancelled) return
        // Opaque backend errors must never leak under the active locale.
        setError(t.documentsTab.loadError)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, t])

  // The screen owns its localized header title; the route-level fallback in
  // app/_layout.tsx is the locale-neutral brand only, so the header never
  // flashes a hardcoded off-locale string.
  const headerTitle = <Stack.Screen options={{ title: t.documentsTab.detailTitle }} />

  if (loading) {
    return (
      <View style={styles.center}>
        {headerTitle}
        <ActivityIndicator color={colors.goldDark} />
      </View>
    )
  }
  if (!doc) {
    return (
      <View style={styles.center}>
        {headerTitle}
        <Text style={styles.error}>{error ?? t.documentsTab.notFound}</Text>
      </View>
    )
  }
  return (
    <>
      {headerTitle}
      <DocumentExplorer document={doc} />
    </>
  )
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    padding: spacing.xl,
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.body,
    textAlign: 'center',
  },
})
