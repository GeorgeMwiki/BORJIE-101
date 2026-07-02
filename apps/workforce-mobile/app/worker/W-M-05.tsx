import { useCallback, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Button } from '../../src/forms/Button'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { miningApi } from '../../src/api/client'
import { ApiError } from '../../src/api/errors'
import { useOnlineStatus } from '../../src/offline/useOnlineStatus'
import { useI18n } from '../../src/i18n/useI18n'
import { enqueueWrite } from '../../src/sync/queue'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-05'
// The list GET exists (mining/cockpit/sic-pings). There is NO reply POST
// endpoint yet — replies stay offline-queued until the gateway lands
// `POST /api/v1/mining/cockpit/sic-pings` (or a /reply sibling).
const MISSING_REPLY_ENDPOINT = 'POST /api/v1/mining/cockpit/sic-pings (reply)'

interface SicPingRow {
  readonly id: string
  readonly siteId: string | null
  readonly status: string
  readonly noteSw: string | null
  readonly pingedAt: string
}

interface SicPingsResponse {
  readonly success: true
  readonly data: { readonly items: ReadonlyArray<SicPingRow> }
}

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
  const { t } = useI18n()
  const copy = t.workerScreens.statusCopy
  const [loads, setLoads] = useState<string>('')
  const [blockers, setBlockers] = useState<string>('')
  const [confirmation, setConfirmation] = useState<'idle' | 'ok' | 'queued'>('idle')

  // Live list — the GET endpoint exists. Honest loading / error / empty.
  const pings = useQuery<ReadonlyArray<SicPingRow>, ApiError>({
    queryKey: ['sic-pings'],
    queryFn: async () => {
      const resp = await miningApi.get<SicPingsResponse>('/cockpit/sic-pings')
      return resp.data.items
    }
  })

  // Reply mutation uses the offline queue because no online SIC ping reply
  // endpoint exists yet — the sync flush will route `sic_ping` to the
  // canonical reply route once it lands.
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

  const items = pings.data ?? []

  return (
    <View>
      <Section title="Pings zinazosubiri">
        {pings.isPending ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.gold} />
            <Text style={styles.muted}>{copy.wm05LoadingPings}</Text>
          </View>
        ) : pings.isError ? (
          <Text style={styles.errorText}>{copy.wm05PingsError}</Text>
        ) : items.length === 0 ? (
          <Text style={styles.muted}>{copy.wm05Empty}</Text>
        ) : (
          items.map((ping) => (
            <View key={ping.id} style={styles.ping}>
              <Text style={styles.pingStatus}>{ping.status.toUpperCase()}</Text>
              {ping.noteSw ? <Text style={styles.pingNote}>{ping.noteSw}</Text> : null}
              <Text style={styles.pingMeta}>
                {new Date(ping.pingedAt).toLocaleString('sw-TZ')}
              </Text>
            </View>
          ))
        )}
      </Section>
      <Section title="Tuma jibu la haraka" hint="Itahifadhiwa kwa sync ukirudi mtandaoni">
        <Text style={styles.replyNote}>{copy.wm05ReplyNotePrefix}{MISSING_REPLY_ENDPOINT}{copy.wm05ReplyNoteSuffix}</Text>
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
            <Text style={styles.muted}>Inahifadhi...</Text>
          </View>
        ) : (
          <Button label="Tuma Jibu" onPress={onSend} disabled={loads.trim().length === 0} />
        )}
        {!online ? <PreviewBanner kind="offline" /> : null}
        {confirmation !== 'idle' ? (
          <View style={styles.confirmBox}>
            <Text style={styles.confirmText}>
              {confirmation === 'ok' ? copy.wm05ReplyOk : copy.wm05ReplyQueued}
            </Text>
          </View>
        ) : null}
        {mutation.error ? (
          <Text style={styles.errorText}>{copy.errorPrefix}{mutation.error.message}</Text>
        ) : null}
      </Section>
    </View>
  )
}

const styles = StyleSheet.create({
  muted: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  replyNote: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginBottom: spacing.sm
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
  ping: {
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1
  },
  pingStatus: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  pingNote: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  pingMeta: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
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
