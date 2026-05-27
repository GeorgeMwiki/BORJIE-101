import { useCallback, useMemo } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Button } from '../../src/forms/Button'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { miningApi } from '../../src/api/client'
import { ApiError } from '../../src/api/errors'
import { useOnlineStatus } from '../../src/offline/useOnlineStatus'
import { useAuth } from '../../src/auth/useAuth'
import { enqueueWrite } from '../../src/sync/queue'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-06'
const HISTORY_LIMIT = 10

const COPY = {
  loading: 'Inapakia historia... · Loading history...',
  empty: 'Bado hujahesabu scoop. · No scoops counted yet.',
  errorPrefix: 'Hitilafu: ',
  scoopOk: 'Scoop imerekodiwa kwenye seva.',
  scoopQueued: 'Scoop imehifadhiwa offline.'
} as const

interface OreParcel {
  readonly id: string
  readonly siteId: string
  readonly massKg: string | null
  readonly storageLocation: string | null
  readonly createdAt: string
}

interface ListResponse {
  readonly success: true
  readonly data: ReadonlyArray<OreParcel>
}

interface CreateParcelInput {
  readonly siteId: string
  readonly massKg?: string
  readonly storageLocation?: string
  readonly attributes?: Record<string, unknown>
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <ExcavatorCounter />
      </ScreenShell>
    </RoleGuard>
  )
}

function ExcavatorCounter(): JSX.Element {
  const { user } = useAuth()
  const { online } = useOnlineStatus()
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => [SCREEN_ID, 'ore-parcels', user?.tenantId ?? ''], [user?.tenantId])

  const history = useQuery<ListResponse, ApiError>({
    queryKey,
    queryFn: () => miningApi.get<ListResponse>('/ore-parcels', { query: { limit: HISTORY_LIMIT } }),
    enabled: Boolean(user)
  })

  const mutation = useMutation<OreParcel, ApiError, CreateParcelInput>({
    mutationFn: async (input) => {
      const resp = await miningApi.post<{ success: true; data: OreParcel }>('/ore-parcels', input)
      return resp.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
    },
    onError: async (error, input) => {
      if (error.status === 0 || !online) {
        await enqueueWrite('excavator_count', input)
      }
    }
  })

  const onTap = useCallback((): void => {
    if (!user) return
    mutation.mutate({
      siteId: user.tenantId,
      storageLocation: 'excavator-tap',
      attributes: { source: 'W-M-06', tapAtIso: new Date().toISOString() }
    })
  }, [mutation, user])

  const rows = history.data?.data ?? []
  const networkError = history.error?.status === 0 || history.error?.status === 503
  const isOffline = !online

  return (
    <View>
      <Section title="Hesabu ya leo" hint="Bonyeza kitufe kikubwa kwa kila scoop">
        <View style={styles.countBox}>
          <Text style={styles.countValue}>{rows.length}</Text>
          <Text style={styles.countLabel}>Scoops</Text>
          <Text style={styles.countCaption}>
            Scoop ya mwisho: {rows[0] ? formatHMS(rows[0].createdAt) : '—'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ongeza scoop moja"
          onPress={onTap}
          disabled={mutation.isPending}
          style={({ pressed }) => [
            styles.fab,
            pressed && styles.fabPressed,
            mutation.isPending && styles.fabBusy
          ]}
        >
          {mutation.isPending ? (
            <ActivityIndicator color={colors.earth900} size="large" />
          ) : (
            <>
              <Text style={styles.fabPlus}>+</Text>
              <Text style={styles.fabLabel}>SCOOP</Text>
            </>
          )}
        </Pressable>
        {isOffline ? <PreviewBanner kind="offline" /> : null}
        {mutation.error && !isOffline && mutation.error.status !== 0 ? (
          <Text style={styles.errorText}>{COPY.errorPrefix}{mutation.error.message}</Text>
        ) : null}
        {mutation.isSuccess ? (
          <Text style={styles.successText}>{COPY.scoopOk}</Text>
        ) : null}
      </Section>
      <Section title={`Historia ya hivi karibuni (${rows.length}/${HISTORY_LIMIT})`}>
        {history.isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.gold} />
            <Text style={styles.muted}>{COPY.loading}</Text>
          </View>
        ) : null}
        {history.error && networkError ? <PreviewBanner kind="env-missing" /> : null}
        {history.error && !networkError ? (
          <Text style={styles.errorText}>{COPY.errorPrefix}{history.error.message}</Text>
        ) : null}
        {!history.isLoading && !history.error && rows.length === 0 ? (
          <View>
            <PreviewBanner kind="no-data" />
            <Text style={styles.muted}>{COPY.empty}</Text>
          </View>
        ) : null}
        {rows.map((parcel, idx) => (
          <View key={parcel.id} style={styles.histRow}>
            <Text style={styles.histIndex}>#{rows.length - idx}</Text>
            <Text style={styles.histTime}>{formatHMS(parcel.createdAt)}</Text>
          </View>
        ))}
      </Section>
    </View>
  )
}

function formatHMS(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

const styles = StyleSheet.create({
  countBox: {
    backgroundColor: colors.earth700,
    padding: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    marginBottom: spacing.md
  },
  countValue: {
    color: colors.gold,
    fontSize: 72,
    fontWeight: '800'
  },
  countLabel: {
    color: colors.textInverse,
    fontSize: fontSize.h3,
    fontWeight: '700',
    marginTop: spacing.xs
  },
  countCaption: {
    color: colors.earth100,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  fab: {
    backgroundColor: colors.gold,
    height: 180,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.earth900,
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6
  },
  fabPressed: {
    backgroundColor: colors.goldDark
  },
  fabBusy: {
    opacity: 0.6
  },
  fabPlus: {
    color: colors.earth900,
    fontSize: 80,
    fontWeight: '800',
    lineHeight: 84
  },
  fabLabel: {
    color: colors.earth900,
    fontSize: fontSize.h2,
    fontWeight: '800',
    letterSpacing: 2,
    marginTop: spacing.xs
  },
  muted: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  histRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.xs,
    gap: spacing.md
  },
  histIndex: {
    color: colors.goldDark,
    fontSize: fontSize.lead,
    fontWeight: '800',
    minWidth: 48
  },
  histTime: {
    color: colors.text,
    fontSize: fontSize.body
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
  },
  successText: {
    color: colors.success,
    fontSize: fontSize.body,
    marginTop: spacing.sm,
    fontWeight: '600'
  }
})
