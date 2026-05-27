import { useCallback, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native'
import { useMutation } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Button } from '../../src/forms/Button'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { ApiError } from '../../src/api/errors'
import { useOnlineStatus } from '../../src/offline/useOnlineStatus'
import { enqueueWrite } from '../../src/sync/queue'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-05'
const MISSING_ENDPOINT = 'GET /api/v1/mining/cockpit/sic-pings'

const COPY = {
  loading: 'Inapakia pings... · Loading pings...',
  empty: 'Hakuna ping mpya. Endelea na kazi. · No new pings.',
  errorPrefix: 'Hitilafu: ',
  missing: `Endpoint haijaundwa: ${MISSING_ENDPOINT}`,
  replyOk: 'Jibu limetumwa kwenye seva.',
  replyQueued: 'Jibu limehifadhiwa offline.'
} as const

interface PingReplyPayload {
  readonly pingId: string
  readonly loads: string
  readonly blockers: string
  readonly repliedAtISO: string
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <PingsView />
      </ScreenShell>
    </RoleGuard>
  )
}

function PingsView(): JSX.Element {
  const { online } = useOnlineStatus()
  const [loads, setLoads] = useState<string>('')
  const [blockers, setBlockers] = useState<string>('')
  const [confirmation, setConfirmation] = useState<'idle' | 'ok' | 'queued'>('idle')

  // Reply mutation always uses the offline queue because no online SIC ping
  // endpoint exists yet — sync queue flush will route to the canonical
  // `/api/v1/mining/sic-pings` once the route lands.
  const mutation = useMutation<{ id: string }, ApiError, PingReplyPayload>({
    mutationFn: async (input) => {
      const queued = await enqueueWrite('sic_ping', input)
      return { id: queued.id }
    },
    onSuccess: () => {
      setConfirmation(online ? 'ok' : 'queued')
      setLoads('')
      setBlockers('')
    }
  })

  const onSend = useCallback((): void => {
    const trimmedLoads = loads.trim()
    const trimmedBlockers = blockers.trim()
    if (trimmedLoads.length === 0) return
    mutation.mutate({
      pingId: `ping-${Date.now()}`,
      loads: trimmedLoads,
      blockers: trimmedBlockers,
      repliedAtISO: new Date().toISOString()
    })
  }, [blockers, loads, mutation])

  return (
    <View>
      <Section title="Pings zinazosubiri" hint="Endpoint ya orodha haijaundwa">
        <PreviewBanner kind="env-missing" />
        <Text style={styles.missing}>{COPY.missing}</Text>
        <Text style={styles.muted}>{COPY.empty}</Text>
      </Section>
      <Section title="Tuma jibu la haraka" hint="Itahifadhiwa kwa sync ukirudi mtandaoni">
        <Text style={styles.fieldLabel}>Mizigo iliyofanyika</Text>
        <TextInput
          value={loads}
          onChangeText={setLoads}
          keyboardType="number-pad"
          placeholder="mfano: 8"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          accessibilityLabel="Mizigo"
        />
        <Text style={styles.fieldLabel}>Vizuizi (kama vipo)</Text>
        <TextInput
          value={blockers}
          onChangeText={setBlockers}
          placeholder="mfano: tairi limepasuka"
          placeholderTextColor={colors.textMuted}
          style={[styles.input, styles.inputMulti]}
          multiline
          accessibilityLabel="Vizuizi"
        />
        {mutation.isPending ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.gold} />
            <Text style={styles.muted}>{COPY.loading}</Text>
          </View>
        ) : (
          <Button label="Tuma Jibu" onPress={onSend} disabled={loads.trim().length === 0} />
        )}
        {!online ? <PreviewBanner kind="offline" /> : null}
        {confirmation !== 'idle' ? (
          <View style={styles.confirmBox}>
            <Text style={styles.confirmText}>
              {confirmation === 'ok' ? COPY.replyOk : COPY.replyQueued}
            </Text>
          </View>
        ) : null}
        {mutation.error ? (
          <Text style={styles.errorText}>{COPY.errorPrefix}{mutation.error.message}</Text>
        ) : null}
      </Section>
    </View>
  )
}

const styles = StyleSheet.create({
  missing: {
    color: colors.warn,
    fontSize: fontSize.caption,
    fontWeight: '700',
    marginBottom: spacing.sm
  },
  muted: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  fieldLabel: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '600',
    marginTop: spacing.sm
  },
  input: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    backgroundColor: colors.surface,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  inputMulti: {
    minHeight: 64
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
    marginTop: spacing.sm
  },
  confirmBox: {
    marginTop: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.success
  },
  confirmText: {
    color: colors.success,
    fontSize: fontSize.body,
    fontWeight: '700'
  },
  errorText: {
    color: colors.danger,
    fontSize: fontSize.body,
    marginTop: spacing.sm
  }
})
