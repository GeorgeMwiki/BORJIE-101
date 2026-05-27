import { useCallback, useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { FingerprintPlaceholder } from '../../src/components/FingerprintPlaceholder'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-15'

interface PpeItem {
  id: string
  name: string
  size: string
  qty: number
  issuedAtISO: string
}

const SEED_PPE: ReadonlyArray<PpeItem> = [
  { id: 'helmet', name: 'Kofia ya usalama', size: 'L', qty: 1, issuedAtISO: '2026-05-27T06:08:00Z' },
  { id: 'boots', name: 'Viatu vya usalama', size: '42', qty: 1, issuedAtISO: '2026-05-27T06:10:00Z' },
  { id: 'gloves', name: 'Glovu za ngozi', size: 'M', qty: 2, issuedAtISO: '2026-05-27T06:11:00Z' },
  { id: 'goggles', name: 'Miwani ya usalama', size: 'Standard', qty: 1, issuedAtISO: '2026-05-27T06:12:00Z' }
]

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
  const [received, setReceived] = useState<boolean>(false)
  const totalQty = useMemo<number>(
    () => SEED_PPE.reduce((sum, item) => sum + item.qty, 0),
    []
  )

  const confirm = useCallback((): void => {
    setReceived(true)
  }, [])

  return (
    <View>
      <Section title="Bidhaa za PPE zilizotolewa leo">
        {SEED_PPE.map((item) => (
          <View key={item.id} style={styles.row}>
            <View style={styles.rowBody}>
              <Text style={styles.rowPrimary}>{item.name}</Text>
              <Text style={styles.rowSecondary}>
                Saizi {item.size} · Kiasi {item.qty} · {formatTime(item.issuedAtISO)}
              </Text>
            </View>
            <View style={styles.qtyBadge}>
              <Text style={styles.qtyBadgeLabel}>×{item.qty}</Text>
            </View>
          </View>
        ))}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Jumla ya vitu</Text>
          <Text style={styles.totalValue}>{totalQty}</Text>
        </View>
      </Section>
      <Section title="Pokea kwa kidole">
        {received ? (
          <View style={styles.confirmed}>
            <Text style={styles.confirmedTitle}>Risiti imethibitishwa</Text>
            <Text style={styles.confirmedHint}>
              Vifaa vya PPE vimepokewa. Tunza vyema na ripoti uharibifu mapema.
            </Text>
          </View>
        ) : (
          <FingerprintPlaceholder label="Nimepokea PPE" onSign={confirm} />
        )}
      </Section>
    </View>
  )
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return iso
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
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
  confirmedTitle: {
    color: colors.success,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  confirmedHint: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  }
})
