import { useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Dropdown } from '../../src/forms/Dropdown'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-10'

type StoreItemId = 'helmet' | 'boots' | 'gloves' | 'goggles' | 'drill-bit' | 'fuel-can'
type StoreAction = 'issue' | 'return'

interface StoreTxn {
  id: string
  itemLabel: string
  qty: number
  action: StoreAction
  atISO: string
}

interface StoreOption {
  value: StoreItemId
  label: string
}

const STORE_OPTIONS: ReadonlyArray<StoreOption> = [
  { value: 'helmet', label: 'Kofia ya usalama' },
  { value: 'boots', label: 'Viatu vya usalama' },
  { value: 'gloves', label: 'Glovu' },
  { value: 'goggles', label: 'Miwani' },
  { value: 'drill-bit', label: 'Kichwa cha kuchimba' },
  { value: 'fuel-can', label: 'Galoni ya mafuta' }
]

const SEED_TXNS: ReadonlyArray<StoreTxn> = [
  { id: 't-1', itemLabel: 'Kofia ya usalama', qty: 2, action: 'issue', atISO: '2026-05-27T06:12:00Z' },
  { id: 't-2', itemLabel: 'Glovu', qty: 4, action: 'issue', atISO: '2026-05-27T07:48:00Z' },
  { id: 't-3', itemLabel: 'Galoni ya mafuta', qty: 1, action: 'return', atISO: '2026-05-26T16:20:00Z' }
]

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
  const [item, setItem] = useState<StoreItemId | null>('helmet')
  const [qty, setQty] = useState<string>('1')
  const [txns, setTxns] = useState<ReadonlyArray<StoreTxn>>(SEED_TXNS)

  const itemLabel = useMemo<string>(() => {
    const found = STORE_OPTIONS.find((option) => option.value === item)
    return found ? found.label : '—'
  }, [item])

  const record = useCallback(
    (action: StoreAction): void => {
      const parsed = Number.parseInt(qty, 10)
      if (!Number.isFinite(parsed) || parsed <= 0 || !item) return
      const next: StoreTxn = {
        id: `t-${txns.length + 1}-${Date.now()}`,
        itemLabel,
        qty: parsed,
        action,
        atISO: new Date().toISOString()
      }
      setTxns([next, ...txns])
      setQty('1')
    },
    [item, itemLabel, qty, txns]
  )

  return (
    <View>
      <Section title="Chagua bidhaa">
        <Dropdown<StoreItemId>
          label="Bidhaa ya stoo"
          value={item}
          onChange={setItem}
          options={STORE_OPTIONS}
          placeholder="Chagua bidhaa"
        />
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
            style={({ pressed }) => [styles.action, styles.issue, pressed && styles.pressed]}
          >
            <Text style={styles.actionLabelDark}>Toa</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Rudisha"
            onPress={() => record('return')}
            style={({ pressed }) => [styles.action, styles.ret, pressed && styles.pressed]}
          >
            <Text style={styles.actionLabel}>Rudisha</Text>
          </Pressable>
        </View>
      </Section>
      <Section title="Mwendo wa hivi karibuni">
        {txns.map((txn) => (
          <View key={txn.id} style={styles.txn}>
            <Text style={styles.txnPrimary}>
              {txn.action === 'issue' ? 'Toa' : 'Rudisha'} · {txn.itemLabel}
            </Text>
            <Text style={styles.txnSecondary}>
              Kiasi {txn.qty} · {formatRelative(txn.atISO)}
            </Text>
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
  label: {
    color: colors.earth900,
    fontSize: fontSize.body,
    fontWeight: '600',
    marginBottom: spacing.xs
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
  }
})
