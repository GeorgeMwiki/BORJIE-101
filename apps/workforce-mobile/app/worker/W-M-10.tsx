import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Dropdown } from '../../src/forms/Dropdown'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { API_BASE_URL } from '../../src/api/config'
import { request } from '../../src/api/client'
import { ApiError } from '../../src/api/errors'
import { useOnlineStatus } from '../../src/offline/useOnlineStatus'
import { useAuth } from '../../src/auth/useAuth'
import { enqueueWrite } from '../../src/sync/queue'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-10'
const WAREHOUSE_PATH = '/api/v1/warehouse/items'

const COPY = {
  loading: 'Inapakia bidhaa... · Loading items...',
  empty: 'Hakuna bidhaa kwenye stoo. · No items in warehouse.',
  loadingMoves: 'Inapakia mwendo... · Loading movements...',
  emptyMoves: 'Hakuna mwendo wa hivi karibuni. · No recent movements.',
  errorPrefix: 'Hitilafu: ',
  txnOk: 'Mwendo umeingia kwenye seva.',
  txnQueued: 'Mwendo umehifadhiwa offline.'
} as const

type StoreAction = 'issue' | 'return'

interface WarehouseItem {
  readonly id: string
  readonly sku: string
  readonly name: string
  readonly category: string
  readonly quantity: number
  readonly condition: string
}

interface Movement {
  readonly id: string
  readonly warehouseItemId: string
  readonly movementType: string
  readonly quantityDelta: number
  readonly createdAt: string
}

interface ItemsResponse {
  readonly success: true
  readonly data: ReadonlyArray<WarehouseItem>
}

interface MovementsResponse {
  readonly success: true
  readonly data: ReadonlyArray<Movement>
}

interface MovementInput {
  readonly itemId: string
  readonly movementType: 'issue' | 'return'
  readonly quantityDelta: number
  readonly reason?: string
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <StoreIssueReturn />
      </ScreenShell>
    </RoleGuard>
  )
}

function StoreIssueReturn(): JSX.Element {
  const { user } = useAuth()
  const { online } = useOnlineStatus()
  const queryClient = useQueryClient()
  const [itemId, setItemId] = useState<string | null>(null)
  const [qty, setQty] = useState<string>('1')
  const [confirmation, setConfirmation] = useState<'idle' | 'ok' | 'queued'>('idle')

  const itemsKey = useMemo(() => [SCREEN_ID, 'items', user?.tenantId ?? ''], [user?.tenantId])
  const movesKey = useMemo(
    () => [SCREEN_ID, 'movements', itemId ?? ''],
    [itemId]
  )

  const items = useQuery<ItemsResponse, ApiError>({
    queryKey: itemsKey,
    queryFn: () => request<ItemsResponse>(`${API_BASE_URL}${WAREHOUSE_PATH}`),
    enabled: Boolean(user)
  })

  const movements = useQuery<MovementsResponse, ApiError>({
    queryKey: movesKey,
    queryFn: () =>
      request<MovementsResponse>(`${API_BASE_URL}${WAREHOUSE_PATH}/${itemId}/movements`),
    enabled: Boolean(itemId)
  })

  const mutation = useMutation<Movement, ApiError, MovementInput>({
    mutationFn: async (input) => {
      const resp = await request<{ success: true; data: Movement }>(
        `${API_BASE_URL}${WAREHOUSE_PATH}/${input.itemId}/movements`,
        {
          method: 'POST',
          body: {
            movementType: input.movementType,
            quantityDelta: input.quantityDelta,
            reason: input.reason
          }
        }
      )
      return resp.data
    },
    onSuccess: () => {
      setConfirmation('ok')
      setQty('1')
      queryClient.invalidateQueries({ queryKey: movesKey })
      queryClient.invalidateQueries({ queryKey: itemsKey })
    },
    onError: async (error, input) => {
      if (error.status === 0 || !online) {
        await enqueueWrite('inventory_move', {
          warehouseItemId: input.itemId,
          movementType: input.movementType,
          quantityDelta: input.quantityDelta,
          reason: input.reason
        })
        setConfirmation('queued')
        setQty('1')
      }
    }
  })

  const itemRows = items.data?.data ?? []
  const itemOptions = useMemo(
    () => itemRows.map((row) => ({ value: row.id, label: `${row.name} · ${row.sku}` })),
    [itemRows]
  )

  const selectedLabel = useMemo<string>(() => {
    const found = itemOptions.find((opt) => opt.value === itemId)
    return found ? found.label : '—'
  }, [itemId, itemOptions])

  const record = useCallback(
    (action: StoreAction): void => {
      const parsed = Number.parseInt(qty, 10)
      if (!Number.isFinite(parsed) || parsed <= 0 || !itemId) return
      mutation.mutate({
        itemId,
        movementType: action,
        quantityDelta: action === 'issue' ? -parsed : parsed,
        reason: `${SCREEN_ID} ${action} ${selectedLabel}`
      })
    },
    [itemId, qty, mutation, selectedLabel]
  )

  const itemsErrorIsMissing = items.error?.status === 503 || items.error?.status === 0
  const movesErrorIsMissing = movements.error?.status === 503 || movements.error?.status === 0
  const moveRows = movements.data?.data ?? []

  return (
    <View>
      <Section title="Chagua bidhaa">
        {items.isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.gold} />
            <Text style={styles.muted}>{COPY.loading}</Text>
          </View>
        ) : null}
        {items.error && itemsErrorIsMissing ? <PreviewBanner kind="env-missing" /> : null}
        {items.error && !itemsErrorIsMissing ? (
          <Text style={styles.errorText}>{COPY.errorPrefix}{items.error.message}</Text>
        ) : null}
        {!items.isLoading && !items.error && itemRows.length === 0 ? (
          <View>
            <PreviewBanner kind="no-data" />
            <Text style={styles.muted}>{COPY.empty}</Text>
          </View>
        ) : null}
        {itemRows.length > 0 ? (
          <Dropdown<string>
            label="Bidhaa ya stoo"
            value={itemId}
            onChange={setItemId}
            options={itemOptions}
            placeholder="Chagua bidhaa"
          />
        ) : null}
        <Text style={styles.label}>Kiasi</Text>
        <TextInput
          accessibilityLabel="Kiasi"
          value={qty}
          onChangeText={setQty}
          keyboardType="number-pad"
          placeholder="1"
          placeholderTextColor={colors.textMuted}
          style={styles.qtyInput}
        />
      </Section>
      <Section title="Chukua hatua">
        <View style={styles.actionRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Toa"
            onPress={() => record('issue')}
            disabled={!itemId || mutation.isPending}
            style={({ pressed }) => [
              styles.action,
              styles.issue,
              (pressed || mutation.isPending) && styles.pressed,
              !itemId && styles.actionDisabled
            ]}
          >
            <Text style={styles.actionLabelDark}>Toa</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Rudisha"
            onPress={() => record('return')}
            disabled={!itemId || mutation.isPending}
            style={({ pressed }) => [
              styles.action,
              styles.ret,
              (pressed || mutation.isPending) && styles.pressed,
              !itemId && styles.actionDisabled
            ]}
          >
            <Text style={styles.actionLabel}>Rudisha</Text>
          </Pressable>
        </View>
        {mutation.isPending ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.gold} />
            <Text style={styles.muted}>{COPY.loading}</Text>
          </View>
        ) : null}
        {!online ? <PreviewBanner kind="offline" /> : null}
        {confirmation === 'ok' ? <Text style={styles.successText}>{COPY.txnOk}</Text> : null}
        {confirmation === 'queued' ? <Text style={styles.warnText}>{COPY.txnQueued}</Text> : null}
        {mutation.error && mutation.error.status !== 0 && mutation.error.status !== 503 ? (
          <Text style={styles.errorText}>{COPY.errorPrefix}{mutation.error.message}</Text>
        ) : null}
      </Section>
      <Section title="Mwendo wa hivi karibuni">
        {!itemId ? <Text style={styles.muted}>Chagua bidhaa ili kuona mwendo.</Text> : null}
        {itemId && movements.isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.gold} />
            <Text style={styles.muted}>{COPY.loadingMoves}</Text>
          </View>
        ) : null}
        {itemId && movements.error && movesErrorIsMissing ? <PreviewBanner kind="env-missing" /> : null}
        {itemId && movements.error && !movesErrorIsMissing ? (
          <Text style={styles.errorText}>{COPY.errorPrefix}{movements.error.message}</Text>
        ) : null}
        {itemId && !movements.isLoading && !movements.error && moveRows.length === 0 ? (
          <View>
            <PreviewBanner kind="no-data" />
            <Text style={styles.muted}>{COPY.emptyMoves}</Text>
          </View>
        ) : null}
        {moveRows.map((mv) => (
          <View key={mv.id} style={styles.txn}>
            <Text style={styles.txnPrimary}>
              {mv.movementType === 'issue' ? 'Toa' : 'Rudisha'} · {Math.abs(mv.quantityDelta)}
            </Text>
            <Text style={styles.txnSecondary}>{formatRelative(mv.createdAt)}</Text>
          </View>
        ))}
      </Section>
    </View>
  )
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return iso
  const minutesAgo = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (minutesAgo < 1) return 'sasa hivi'
  if (minutesAgo < 60) return `dakika ${minutesAgo} zilizopita`
  const hoursAgo = Math.round(minutesAgo / 60)
  if (hoursAgo < 24) return `saa ${hoursAgo} zilizopita`
  return `siku ${Math.round(hoursAgo / 24)} zilizopita`
}

const styles = StyleSheet.create({
  muted: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  label: {
    color: colors.earth900,
    fontSize: fontSize.body,
    fontWeight: '600',
    marginBottom: spacing.xs,
    marginTop: spacing.sm
  },
  qtyInput: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: fontSize.lead,
    minHeight: 48
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.md
  },
  action: {
    flex: 1,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center'
  },
  actionDisabled: {
    opacity: 0.5
  },
  issue: {
    backgroundColor: colors.gold
  },
  ret: {
    backgroundColor: colors.earth700
  },
  pressed: {
    opacity: 0.85
  },
  actionLabel: {
    color: colors.textInverse,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  actionLabelDark: {
    color: colors.earth900,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  txn: {
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1
  },
  txnPrimary: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600'
  },
  txnSecondary: {
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
