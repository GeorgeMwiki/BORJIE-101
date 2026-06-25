import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { FingerprintPlaceholder } from '../../src/components/FingerprintPlaceholder'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { miningApi } from '../../src/api/client'
import { ApiError } from '../../src/api/errors'
import { useOnlineStatus } from '../../src/offline/useOnlineStatus'
import { useAuth } from '../../src/auth/useAuth'
import { useI18n } from '../../src/i18n/useI18n'
import { localizeApiError } from '@borjie/error-catalog'
import { documentStatusLabel } from '../../src/i18n/enumLabels'
import { enqueueWrite } from '../../src/sync/queue'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-18'

const COPY = {
  loading: 'Inasaini... · Signing...',
  listLoading: 'Inapakia hati... · Loading documents...',
  errorPrefix: 'Hitilafu: ',
  listError: 'Imeshindwa kupakia hati. · Failed to load documents.',
  empty: 'Hakuna hati za kusaini. · No documents to sign.',
  signOk: 'Hati imesainiwa kwenye seva.',
  signQueued: 'Sahihi imehifadhiwa offline kwa sync.',
  hint: 'Chagua hati uliyopewa na meneja, kisha bonyeza saini.'
} as const

interface DocumentRow {
  readonly id: string
  readonly fileName: string
  readonly status: string
  readonly verifiedAt: string | null
  readonly verifiedBy: string | null
}

interface DocumentsListResponse {
  readonly success: true
  readonly data: ReadonlyArray<DocumentRow>
}

interface SignResponse {
  readonly success: true
  readonly data: DocumentRow
}

interface SignPayload {
  readonly documentId: string
  readonly fingerprintEventId: string
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <DocumentSigning />
      </ScreenShell>
    </RoleGuard>
  )
}

function DocumentSigning(): JSX.Element {
  const { user } = useAuth()
  const { t, lang } = useI18n()
  const { online } = useOnlineStatus()
  const queryClient = useQueryClient()
  const [docId, setDocId] = useState<string>('')
  const [signedDocId, setSignedDocId] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<'idle' | 'ok' | 'queued'>('idle')

  const docsQuery = useQuery<ReadonlyArray<DocumentRow>, ApiError>({
    queryKey: ['mining', 'documents', 'signable'],
    queryFn: async ({ signal }) => {
      const resp = await miningApi.get<DocumentsListResponse>('/documents', { signal })
      return resp.data ?? []
    }
  })

  const mutation = useMutation<DocumentRow, ApiError, SignPayload>({
    mutationFn: async (input) => {
      const resp = await miningApi.post<SignResponse>(`/documents/${input.documentId}/sign`, {
        fingerprintEventId: input.fingerprintEventId,
        signerRole: user?.role ?? null,
        note: `Signed via ${SCREEN_ID}`
      })
      return resp.data
    },
    onSuccess: async (row) => {
      setSignedDocId(row.id)
      setConfirmation('ok')
      setDocId('')
      await queryClient.invalidateQueries({ queryKey: ['mining', 'documents', 'signable'] })
    },
    onError: async (error, input) => {
      if (error.status === 0 || !online) {
        await enqueueWrite('fingerprint_sign', {
          documentId: input.documentId,
          fingerprintEventId: input.fingerprintEventId,
          signedAtIso: new Date().toISOString(),
          signerRole: user?.role ?? null
        })
        setSignedDocId(input.documentId)
        setConfirmation('queued')
        setDocId('')
      }
    }
  })

  const onSign = useCallback((): void => {
    const trimmed = docId.trim()
    if (trimmed.length === 0) return
    mutation.mutate({
      documentId: trimmed,
      fingerprintEventId: `fp-${SCREEN_ID}-${Date.now()}`
    })
  }, [docId, mutation])

  const submitError = mutation.error
  const networkError = submitError?.status === 0 || submitError?.status === 503
  const notFound = submitError?.status === 404
  const docs = docsQuery.data ?? []

  return (
    <View>
      <Section title="Hati za rasmi">
        <Text style={styles.muted}>{COPY.hint}</Text>
        {docsQuery.isPending ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.gold} />
            <Text style={styles.muted}>{COPY.listLoading}</Text>
          </View>
        ) : docsQuery.isError ? (
          <Text style={styles.errorText}>{COPY.listError}</Text>
        ) : docs.length === 0 ? (
          <Text style={styles.empty}>{COPY.empty}</Text>
        ) : (
          docs.map((doc) => {
            const selected = docId === doc.id
            return (
              <Pressable
                key={doc.id}
                accessibilityRole="button"
                accessibilityLabel={doc.fileName}
                onPress={() => setDocId(doc.id)}
                style={[styles.docRow, selected ? styles.docRowSelected : null]}
              >
                <Text style={styles.docTitle}>{doc.fileName}</Text>
                <Text style={styles.docMeta}>{documentStatusLabel(doc.status, t)}</Text>
              </Pressable>
            )
          })
        )}
      </Section>
      <Section title="Saini kwa kidole">
        {confirmation === 'ok' && signedDocId ? (
          <View style={styles.preview}>
            <Text style={styles.previewTitle}>{COPY.signOk}</Text>
            <Text style={styles.previewRef}>Ref: {signedDocId}</Text>
          </View>
        ) : confirmation === 'queued' && signedDocId ? (
          <View style={[styles.preview, styles.previewWarn]}>
            <Text style={styles.previewWarnTitle}>{COPY.signQueued}</Text>
            <Text style={styles.previewRef}>Ref: {signedDocId}</Text>
          </View>
        ) : mutation.isPending ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.gold} />
            <Text style={styles.muted}>{COPY.loading}</Text>
          </View>
        ) : docId.trim().length === 0 ? (
          <FingerprintPlaceholder label="Chagua hati kwanza" />
        ) : (
          <FingerprintPlaceholder label="Saini kwa kidole" onSign={onSign} />
        )}
        {!online ? <PreviewBanner kind="offline" /> : null}
        {notFound ? <Text style={styles.errorText}>Hati haijapatikana kwenye seva.</Text> : null}
        {submitError && !networkError && !notFound ? (
          <Text style={styles.errorText}>
            {localizeApiError(submitError.code, lang)}
          </Text>
        ) : null}
      </Section>
    </View>
  )
}

const styles = StyleSheet.create({
  muted: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.sm
  },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.sm
  },
  docRow: {
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.sm
  },
  docRowSelected: {
    borderColor: colors.gold
  },
  docTitle: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  docMeta: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  },
  preview: {
    padding: spacing.lg,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.success
  },
  previewWarn: {
    borderLeftColor: colors.warn
  },
  previewTitle: {
    color: colors.success,
    fontSize: fontSize.h3,
    fontWeight: '700'
  },
  previewWarnTitle: {
    color: colors.warn,
    fontSize: fontSize.h3,
    fontWeight: '700'
  },
  previewRef: {
    color: colors.goldDark,
    fontSize: fontSize.caption,
    fontWeight: '700',
    marginTop: spacing.xs
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md
  },
  errorText: {
    color: colors.danger,
    fontSize: fontSize.body,
    marginTop: spacing.sm
  }
})
