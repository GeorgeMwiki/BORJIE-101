import { useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-14'

interface StockItem {
  id: string
  name: string
  unit: string
  onHand: number
  dailyUse: number
  reorderLevel: number
  site: string
}

const STOCK: ReadonlyArray<StockItem> = [
  { id: 'diesel', name: 'Dieseli', unit: 'L', onHand: 1840, dailyUse: 200, reorderLevel: 500, site: 'Geita' },
  { id: 'ppe-helmet', name: 'PPE - Helmeti', unit: 'pcs', onHand: 18, dailyUse: 0.8, reorderLevel: 6, site: 'Geita' },
  { id: 'grease', name: 'Grisi', unit: 'kg', onHand: 24, dailyUse: 1.6, reorderLevel: 8, site: 'Geita' },
  { id: 'cyanide', name: 'Cyanide (NaCN)', unit: 'kg', onHand: 120, dailyUse: 12, reorderLevel: 50, site: 'Chunya' },
  { id: 'explosive', name: 'Vilipuzi', unit: 'kg', onHand: 60, dailyUse: 6, reorderLevel: 30, site: 'Geita' },
  { id: 'gloves', name: 'PPE - Glovu', unit: 'jozi', onHand: 40, dailyUse: 2.0, reorderLevel: 12, site: 'Mwanza' }
]

type Tab = 'all' | 'critical' | 'low' | 'ok'

const TAB_LABEL: Readonly<Record<Tab, string>> = {
  all: 'Zote',
  critical: 'Hatari',
  low: 'Chini',
  ok: 'Salama'
}

function daysLeft(item: StockItem): number {
  if (item.dailyUse <= 0) return 9999
  return Math.floor(item.onHand / item.dailyUse)
}

type Status = 'critical' | 'low' | 'ok'

function statusOf(item: StockItem): Status {
  const d = daysLeft(item)
  if (d <= 3) return 'critical'
  if (d <= 10) return 'low'
  return 'ok'
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <StoresAndPurchases />
      </ScreenShell>
    </RoleGuard>
  )
}

function StoresAndPurchases(): JSX.Element {
  const [tab, setTab] = useState<Tab>('all')
  const [reorderQueue, setReorderQueue] = useState<ReadonlyArray<string>>([])

  const visible = useMemo<ReadonlyArray<StockItem>>(() => {
    if (tab === 'all') return STOCK
    return STOCK.filter((s) => statusOf(s) === tab)
  }, [tab])

  const counts = useMemo(() => {
    return STOCK.reduce(
      (acc, s) => {
        const st = statusOf(s)
        return { ...acc, [st]: acc[st] + 1 }
      },
      { critical: 0, low: 0, ok: 0 } as Readonly<Record<'critical' | 'low' | 'ok', number>>
    )
  }, [])

  const queueReorder = useCallback((id: string): void => {
    setReorderQueue((current) =>
      current.includes(id) ? current.filter((q) => q !== id) : [...current, id]
    )
  }, [])

  return (
    <View>
      <Section title={`Hatari ${counts.critical} - Chini ${counts.low} - Salama ${counts.ok}`}>
        <View style={styles.tabRow}>
          {(['all', 'critical', 'low', 'ok'] as ReadonlyArray<Tab>).map((t) => (
            <Pressable
              key={t}
              accessibilityRole="button"
              accessibilityLabel={`Tab ${TAB_LABEL[t]}`}
              onPress={() => setTab(t)}
              style={[styles.tab, tab === t && styles.tabActive]}
            >
              <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>{TAB_LABEL[t]}</Text>
            </Pressable>
          ))}
        </View>
      </Section>
      <Section title={`Foleni ya kuagiza: ${reorderQueue.length}`}>
        {visible.map((item) => {
          const d = daysLeft(item)
          const st = statusOf(item)
          const queued = reorderQueue.includes(item.id)
          const toneColor = st === 'critical' ? colors.danger : st === 'low' ? colors.warn : colors.success
          return (
            <View key={item.id} style={[styles.card, { borderLeftColor: toneColor }]}>
              <Text style={styles.cardName}>{item.name}</Text>
              <Text style={styles.cardMeta}>
                {item.onHand} {item.unit} - {item.site} - Tumia kila siku {item.dailyUse} {item.unit}
              </Text>
              <Text style={[styles.cardDays, { color: toneColor }]}>
                {d >= 9999 ? 'Siku haijulikani' : `Siku ${d} zilizobaki`}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Agiza ${item.name}`}
                onPress={() => queueReorder(item.id)}
                style={[styles.reorderBtn, queued && styles.reorderBtnActive]}
              >
                <Text style={[styles.reorderLabel, queued && styles.reorderLabelActive]}>
                  {queued ? 'Imewekwa kwenye foleni' : 'Weka kwenye foleni ya kuagiza'}
                </Text>
              </Pressable>
            </View>
          )
        })}
      </Section>
    </View>
  )
}

const styles = StyleSheet.create({
  tabRow: { flexDirection: 'row', gap: spacing.sm },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    alignItems: 'center'
  },
  tabActive: { backgroundColor: colors.gold, borderColor: colors.goldDark },
  tabLabel: { color: colors.textMuted, fontSize: fontSize.caption, fontWeight: '600' },
  tabLabelActive: { color: colors.earth900 },
  card: {
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 4
  },
  cardName: { color: colors.text, fontSize: fontSize.lead, fontWeight: '700' },
  cardMeta: { color: colors.textMuted, fontSize: fontSize.body, marginTop: spacing.xs },
  cardDays: { fontSize: fontSize.body, fontWeight: '700', marginTop: spacing.xs },
  reorderBtn: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    alignItems: 'center'
  },
  reorderBtnActive: { backgroundColor: colors.gold, borderColor: colors.goldDark },
  reorderLabel: { color: colors.text, fontSize: fontSize.body, fontWeight: '600' },
  reorderLabelActive: { color: colors.earth900, fontWeight: '700' }
})
