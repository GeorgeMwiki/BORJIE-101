import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useMutation } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { miningApi } from '../../src/api/client'
import { ApiError } from '../../src/api/errors'
import { useOnlineStatus } from '../../src/offline/useOnlineStatus'
import { useAuth } from '../../src/auth/useAuth'
import { enqueueWrite } from '../../src/sync/queue'
import { buildDriverLetterPdf } from '../../src/documents/driverLetterPdf'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-20'

const COPY = {
  loading: 'Inatengeneza barua... · Creating letter...',
  errorPrefix: 'Hitilafu: ',
  hint: 'Weka taarifa za safari, kisha tuma. Barua itahifadhiwa kama PDF kwenye seva.',
  letterOk: 'Barua (PDF) imepakiwa kwenye seva.',
  letterQueued: 'Barua imehifadhiwa offline kwa sync.',
  uploadIncomplete:
    'Taarifa zimehifadhiwa lakini PDF haijapakiwa (seva ya hifadhi haikubali upload wa moja kwa moja).'
} as const

interface DocumentRow {
  readonly id: string
  readonly fileName: string
  readonly fileUrl: string
  readonly documentType: string
  readonly entityType: string | null
  readonly entityId: string | null
}

interface UploadResponse {
  readonly success: true
  readonly data: { readonly document: DocumentRow; readonly presignedPut: string }
}

interface LetterDraft {
  readonly truckReg: string
  readonly driverName: string
  readonly mineral: string
  readonly tonnage: string
  readonly routeFrom: string
  readonly routeTo: string
}

type IssueResult =
  | { readonly row: DocumentRow; readonly uploaded: true }
  | { readonly row: DocumentRow; readonly uploaded: false }

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <DriverLetterView />
      </ScreenShell>
    </RoleGuard>
  )
}

function DriverLetterView(): JSX.Element {
  const { user } = useAuth()
  const { online } = useOnlineStatus()
  const [draft, setDraft] = useState<LetterDraft>({
    truckReg: '',
    driverName: '',
    mineral: '',
    tonnage: '',
    routeFrom: '',
    routeTo: ''
  })
  const [issued, setIssued] = useState<DocumentRow | null>(null)
  const [confirmation, setConfirmation] = useState<'idle' | 'ok' | 'incomplete' | 'queued'>(
    'idle'
  )

  const mutation = useMutation<IssueResult, ApiError, LetterDraft>({
    mutationFn: async (input) => {
      const pdfBytes = buildDriverLetterPdf({
        truckReg: input.truckReg.trim(),
        driverName: input.driverName.trim(),
        mineral: input.mineral.trim(),
        tonnage: input.tonnage.trim(),
        routeFrom: input.routeFrom.trim(),
        routeTo: input.routeTo.trim(),
        issuedAtIso: new Date().toISOString()
      })
      const filename = `driver-letter-${input.truckReg.trim() || Date.now()}.pdf`
      // 1) Record metadata + obtain the presigned PUT target.
      const resp = await miningApi.post<UploadResponse>('/documents/upload', {
        fileName: filename,
        fileSize: pdfBytes.byteLength,
        mimeType: 'application/pdf',
        documentType: 'other',
        entityType: 'driver_letter',
        entityId: user?.id ?? null,
        tags: ['driver_letter', SCREEN_ID],
        metadata: {
          truckReg: input.truckReg.trim(),
          driverName: input.driverName.trim(),
          mineral: input.mineral.trim(),
          tonnage: input.tonnage.trim(),
          routeFrom: input.routeFrom.trim(),
          routeTo: input.routeTo.trim(),
          issuedAtIso: new Date().toISOString()
        }
      })
      // 2) PUT the actual PDF bytes to the presigned target. The gateway
      // only returns a directly-uploadable URL when storage is wired with
      // an HTTP(S) presign; if it hands back an opaque (e.g. s3://) URI we
      // cannot PUT from the device, so we report the upload as incomplete
      // rather than claim a fake success.
      const target = resp.data.presignedPut
      const uploaded = await putPdf(target, pdfBytes)
      return { row: resp.data.document, uploaded }
    },
    onSuccess: (result) => {
      setIssued(result.row)
      setConfirmation(result.uploaded ? 'ok' : 'incomplete')
    },
    onError: async (error, input) => {
      if (error.status === 0 || !online) {
        const queued = await enqueueWrite('driver_letter_ack', input)
        setIssued({
          id: queued.id,
          fileName: `driver-letter-${input.truckReg || queued.id}.pdf`,
          fileUrl: '',
          documentType: 'other',
          entityType: 'driver_letter',
          entityId: user?.id ?? null
        })
        setConfirmation('queued')
      }
    }
  })

  const setField = useCallback(
    (key: keyof LetterDraft) =>
      (value: string): void => {
        setDraft((prev) => ({ ...prev, [key]: value }))
      },
    []
  )

  const onSubmit = useCallback((): void => {
    mutation.mutate(draft)
  }, [draft, mutation])

  const disabled =
    draft.truckReg.trim().length === 0 ||
    draft.driverName.trim().length === 0 ||
    draft.routeFrom.trim().length === 0 ||
    draft.routeTo.trim().length === 0

  const submitError = mutation.error
  const networkError = submitError?.status === 0 || submitError?.status === 503

  return (
    <View>
      <Section title="Barua ya dereva" hint="Itahifadhiwa kama PDF kwenye seva">
        <Text style={styles.muted}>{COPY.hint}</Text>
      </Section>
      <Section title="Maelezo ya safari">
        {Object.entries(FIELDS).map(([key, label]) => (
          <View key={key} style={styles.fieldRow}>
            <Text style={styles.label}>{label}</Text>
            <TextInput
              accessibilityLabel={label}
              value={draft[key as keyof LetterDraft]}
              onChangeText={setField(key as keyof LetterDraft)}
              placeholder={label}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
          </View>
        ))}
        {mutation.isPending ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.gold} />
            <Text style={styles.muted}>{COPY.loading}</Text>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tuma barua"
            onPress={onSubmit}
            disabled={disabled}
            style={({ pressed }) => [
              styles.submitBtn,
              pressed && styles.pressed,
              disabled && styles.submitDisabled
            ]}
          >
            <Text style={styles.submitLabel}>Tuma barua</Text>
          </Pressable>
        )}
        {!online ? <PreviewBanner kind="offline" /> : null}
        {submitError && !networkError ? (
          <Text style={styles.errorText}>{COPY.errorPrefix}{submitError.message}</Text>
        ) : null}
      </Section>
      {issued ? (
        <Section title="Risiti ya seva">
          <View
            style={[
              styles.letter,
              confirmation === 'queued' && styles.letterWarn,
              confirmation === 'incomplete' && styles.letterWarn
            ]}
          >
            <Text style={styles.letterRef}>{issued.id}</Text>
            <Text style={styles.letterStamp}>{issued.fileName}</Text>
            <Text
              style={confirmation === 'ok' ? styles.successText : styles.warnText}
            >
              {confirmation === 'ok'
                ? COPY.letterOk
                : confirmation === 'incomplete'
                  ? COPY.uploadIncomplete
                  : COPY.letterQueued}
            </Text>
          </View>
        </Section>
      ) : null}
    </View>
  )
}

/**
 * PUT the PDF bytes to the presigned target. Returns `true` only when the
 * blob was actually accepted by storage. Returns `false` (no throw) when
 * the target is not a device-uploadable HTTP(S) URL, so the caller can
 * render an honest "metadata saved, upload pending" state instead of a
 * fabricated success. Network failures on a real HTTP(S) PUT propagate as
 * ApiError so the offline-queue path can engage.
 */
async function putPdf(target: string, bytes: Uint8Array): Promise<boolean> {
  if (!/^https?:\/\//i.test(target)) {
    return false
  }
  let response: Response
  try {
    response = await fetch(target, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: bytes
    })
  } catch (cause) {
    throw new ApiError(
      cause instanceof Error ? cause.message : 'PDF upload failed',
      0,
      target,
      null
    )
  }
  if (!response.ok) {
    throw new ApiError(
      `PDF upload failed with ${response.status}`,
      response.status,
      target,
      null
    )
  }
  return true
}

const FIELDS: Readonly<Record<keyof LetterDraft, string>> = {
  truckReg: 'Namba ya gari',
  driverName: 'Jina la dereva',
  mineral: 'Aina ya madini',
  tonnage: 'Uzito (tani)',
  routeFrom: 'Kutoka',
  routeTo: 'Kwenda'
}

const styles = StyleSheet.create({
  muted: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.sm
  },
  fieldRow: {
    marginBottom: spacing.sm
  },
  label: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '600',
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
  submitBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.gold,
    borderRadius: radius.md,
    alignItems: 'center'
  },
  submitDisabled: {
    opacity: 0.5
  },
  submitLabel: {
    color: colors.earth900,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  pressed: {
    opacity: 0.85
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md
  },
  letter: {
    padding: spacing.lg,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.success
  },
  letterWarn: {
    borderLeftColor: colors.warn
  },
  letterRef: {
    color: colors.goldDark,
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 1
  },
  letterStamp: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  },
  successText: {
    color: colors.success,
    fontSize: fontSize.body,
    marginTop: spacing.sm,
    fontWeight: '600'
  },
  warnText: {
    color: colors.warn,
    fontSize: fontSize.body,
    marginTop: spacing.sm,
    fontWeight: '600'
  },
  errorText: {
    color: colors.danger,
    fontSize: fontSize.body,
    marginTop: spacing.sm
  }
})
