import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { FingerprintPlaceholder } from '../../src/components/FingerprintPlaceholder'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { API_BASE_URL } from '../../src/api/config'
import { request } from '../../src/api/client'
import { ApiError } from '../../src/api/errors'
import { useOnlineStatus } from '../../src/offline/useOnlineStatus'
import { useAuth } from '../../src/auth/useAuth'
import { enqueueWrite } from '../../src/sync/queue'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-15'
const WAREHOUSE_PATH = '/api/v1/warehouse/items'
const PPE_CATEGORY = 'PPE'

const COPY = {
  loading: 'Inapakia PPE... · Loading PPE list...',
  empty: 'Hakuna PPE iliyotolewa leo. · No PPE issued today.',
  errorPrefix: 'Hitilafu: ',
  ackOk: 'Risiti ya PPE imethibitishwa kwenye seva.',
  ackQueued: 'Risiti imehifadhiwa offline.'
} as const

interface WarehouseItem {
  readonly id: string
  readonly sku: string
  readonly name: string
  readonly category: string
  readonly quantity: number
  readonly condition: string
}

interface ItemsResponse {
  readonly success: true
  readonly data: ReadonlyArray<WarehouseItem>
}

interface MovementResponse {
  readonly success: true
  readonly data: unknown
}

interface ReceiptPayload {
  readonly itemId: string
  readonly fingerprintEventId: string
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <PpeReceipt />
      </ScreenShell>
    </RoleGuard>
  )
}

function PpeReceipt(): JSX.Element {
  const { user } = useAuth()
  const { online } = useOnlineStatus()
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => [SCREEN_ID, 'ppe-items', user?.tenantId ?? ''], [user?.tenantId])
  const [confirmation, setConfirmation] = useState<'idle' | 'ok' | 'queued'>('idle')

  const query = useQuery<ItemsResponse, ApiError>({
    queryKey,
    queryFn: () =>
      request<ItemsResponse>(`${API_BASE_URL}${WAREHOUSE_PATH}`, {
        query: { category: PPE_CATEGORY }
      }),
    enabled: Boolean(user)
  })

  const mutation = useMutation<ReadonlyArray<MovementResponse>, ApiError, ReceiptPayload[]>({
    mutationFn: async (entries) => {
      const results: MovementResponse[] = []
      for (const entry of entries) {
        const resp = await request<MovementResponse>(
          `${API_BASE_URL}${WAREHOUSE_PATH}/${entry.itemId}/movements`,
          {
            method: 'POST',
            body: {
              movementType: 'issue',
              quantityDelta: -1,
              reason: `PPE receipt acknowledged via ${SCREEN_ID}`,
              metadata: { fingerprintEventId: entry.fingerprintEventId }
            }
          }
        )
        results.push(resp)
      }
      return results
    },
    onSuccess: () => {
      setConfirmation('ok')
      queryClient.invalidateQueries({ queryKey })
    },
    onError: async (error, entries) => {
      if (error.status === 0 || !online) {
        for (const entry of entries) {
          await enqueueWrite('ppe_receipt', entry)
        }
        setConfirmation('queued')
      }
    }
  })

  const items = query.data?.data ?? []
  const networkError = query.error?.status === 0 || query.error?.status === 503
  const totalQty = useMemo(
    () => items.reduce((sum, item) => sum + Math.max(item.quantity, 0), 0),
    [items]
  )

  const confirm = useCallback((): void => {
    if (items.length === 0) return
    const entries: ReceiptPayload[] = items.map((item) => ({
      itemId: item.id,
      fingerprintEventId: `fp-ppe-${item.id.slice(0, 8)}-${Date.now()}`
    }))
    mutation.mutate(entries)
  }, [items, mutation])

  return (
    <View>
      <Section title="Bidhaa za PPE zilizotolewa">
        {query.isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.gold} />
            <Text style={styles.muted}>{COPY.loading}</Text>
          </View>
        ) : null}
        {query.error && networkError ? <PreviewBanner kind="env-missing" /> : null}
        {query.error && !networkError ? (
          <Text style={styles.errorText}>{COPY.errorPrefix}{query.error.message}</Text>
        ) : null}
        {!query.isLoading && !query.error && items.length === 0 ? (
          <View>
            <PreviewBanner kind="no-data" />
            <Text style={styles.muted}>{COPY.empty}</Text>
          </View>
        ) : null}
        {items.map((item) => (
          <View key={item.id} style={styles.row}>
            <View style={styles.rowBody}>
              <Text style={styles.rowPrimary}>{item.name}</Text>
              <Text style={styles.rowSecondary}>
                SKU {item.sku} · Hali: {item.condition}
              </Text>
            </View>
            <View style={styles.qtyBadge}>
              <Text style={styles.qtyBadgeLabel}>×{Math.max(item.quantity, 0)}</Text>
            </View>
          </View>
        ))}
        {items.length > 0 ? (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Jumla ya vitu</Text>
            <Text style={styles.totalValue}>{totalQty}</Text>
          </View>
        ) : null}
      </Section>
      <Section title="Pokea kwa kidole">
        {confirmation === 'ok' ? (
          <View style={styles.confirmed}>
            <Text style={styles.confirmedTitle}>{COPY.ackOk}</Text>
          </View>
        ) : confirmation === 'queued' ? (
          <View style={[styles.confirmed, styles.confirmedWarn]}>
            <Text style={styles.confirmedWarnTitle}>{COPY.ackQueued}</Text>
          </View>
        ) : mutation.isPending ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.gold} />
            <Text style={styles.muted}>{COPY.loading}</Text>
          </View>
        ) : items.length === 0 ? (
          <FingerprintPlaceholder label="Hakuna PPE" />
        ) : (
          <FingerprintPlaceholder label="Nimepokea PPE" onSign={confirm} />
        )}
        {!online ? <PreviewBanner kind="offline" /> : null}
        {mutation.error && mutation.error.status !== 0 && mutation.error.status !== 503 ? (
          <Text style={styles.errorText}>{COPY.errorPrefix}{mutation.error.message}</Text>
        ) : null}
      </Section>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm
  },
  rowBody: {
    flex: 1
  },
  rowPrimary: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600'
  },
  rowSecondary: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  },
  qtyBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.gold,
    borderRadius: radius.pill
  },
  qtyBadgeLabel: {
    color: colors.earth900,
    fontWeight: '700',
    fontSize: fontSize.body
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.sm
  },
  totalLabel: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  totalValue: {
    color: colors.text,
    fontSize: fontSize.h3,
    fontWeight: '700'
  },
  confirmed: {
    padding: spacing.lg,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.success
  },
  confirmedWarn: {
    borderLeftColor: colors.warn
  },
  confirmedTitle: {
    color: colors.success,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  confirmedWarnTitle: {
    color: colors.warn,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md
  },
  muted: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  errorText: {
    color: colors.danger,
    fontSize: fontSize.body,
    marginTop: spacing.sm
  }
})
