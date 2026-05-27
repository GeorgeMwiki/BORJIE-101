import { useCallback, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native'
import { useMutation } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { FingerprintPlaceholder } from '../../src/components/FingerprintPlaceholder'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { miningApi } from '../../src/api/client'
import { ApiError } from '../../src/api/errors'
import { useOnlineStatus } from '../../src/offline/useOnlineStatus'
import { useAuth } from '../../src/auth/useAuth'
import { enqueueWrite } from '../../src/sync/queue'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-18'
const MISSING_LIST_ENDPOINT = 'GET /api/v1/mining/documents'

const COPY = {
  loading: 'Inasaini... · Signing...',
  errorPrefix: 'Hitilafu: ',
  missing: `Endpoint ya orodha haijaundwa: ${MISSING_LIST_ENDPOINT}`,
  signOk: 'Hati imesainiwa kwenye seva.',
  signQueued: 'Sahihi imehifadhiwa offline kwa sync.',
  hint: 'Weka rejeleo la hati uliyopewa na meneja, kisha bonyeza saini.'
} as const

interface DocumentRow {
  readonly id: string
  readonly fileName: string
  readonly status: string
  readonly verifiedAt: string | null
  readonly verifiedBy: string | null
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
  const { online } = useOnlineStatus()
  const [docId, setDocId] = useState<string>('')
  const [signedDocId, setSignedDocId] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<'idle' | 'ok' | 'queued'>('idle')

  const mutation = useMutation<DocumentRow, ApiError, SignPayload>({
    mutationFn: async (input) => {
      const resp = await miningApi.post<SignResponse>(`/documents/${input.documentId}/sign`, {
        fingerprintEventId: input.fingerprintEventId,
        signerRole: user?.role ?? null,
        note: `Signed via ${SCREEN_ID}`
      })
      return resp.data
    },
    onSuccess: (row) => {
      setSignedDocId(row.id)
      setConfirmation('ok')
      setDocId('')
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

  return (
    <View>
      <Section title="Hati za rasmi">
        <PreviewBanner kind="env-missing" />
        <Text style={styles.missing}>{COPY.missing}</Text>
        <Text style={styles.muted}>{COPY.hint}</Text>
        <Text style={styles.label}>Rejeleo la hati (Document ID)</Text>
        <TextInput
          accessibilityLabel="Document ID"
          value={docId}
          onChangeText={setDocId}
          placeholder="mfano: 9f6d2c..."
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
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
          <FingerprintPlaceholder label="Weka Document ID kwanza" />
        ) : (
          <FingerprintPlaceholder label="Saini kwa kidole" onSign={onSign} />
        )}
        {!online ? <PreviewBanner kind="offline" /> : null}
        {notFound ? <Text style={styles.errorText}>Hati haijapatikana kwenye seva.</Text> : null}
        {submitError && !networkError && !notFound ? (
          <Text style={styles.errorText}>{COPY.errorPrefix}{submitError.message}</Text>
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
  missing: {
    color: colors.warn,
    fontSize: fontSize.caption,
    fontWeight: '700',
    marginTop: spacing.sm
  },
  label: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '600',
    marginTop: spacing.md,
    marginBottom: spacing.xs
  },
  input: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    backgroundColor: colors.surface,
    fontSize: fontSize.body
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
