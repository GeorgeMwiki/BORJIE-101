import { useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-13'

type AssetKind = 'excavator' | 'tipper' | 'generator' | 'pump'

interface Asset {
  id: string
  label: string
  kind: AssetKind
  utilizationPct: number
  serviceDueInDays: number
  site: string
}

const ASSETS: ReadonlyArray<Asset> = [
  { id: 'EX-1', label: 'Excavator-1', kind: 'excavator', utilizationPct: 72, serviceDueInDays: 4, site: 'Geita' },
  { id: 'EX-2', label: 'Excavator-2', kind: 'excavator', utilizationPct: 41, serviceDueInDays: 0, site: 'Chunya' },
  { id: 'TP-7', label: 'Tipper 7-tonne', kind: 'tipper', utilizationPct: 88, serviceDueInDays: 12, site: 'Geita' },
  { id: 'TP-8', label: 'Tipper 7-tonne', kind: 'tipper', utilizationPct: 64, serviceDueInDays: 6, site: 'Mwanza' },
  { id: 'GEN-3', label: 'Genset 80 kVA', kind: 'generator', utilizationPct: 22, serviceDueInDays: -2, site: 'Chunya' },
  { id: 'PMP-2', label: 'Dewatering pump', kind: 'pump', utilizationPct: 56, serviceDueInDays: 18, site: 'Geita' }
]

const KIND_LABEL: Readonly<Record<AssetKind, string>> = {
  excavator: 'Excavator',
  tipper: 'Tipper',
  generator: 'Jenereta',
  pump: 'Pampu'
}

const FILTERS: ReadonlyArray<AssetKind | 'all'> = ['all', 'excavator', 'tipper', 'generator', 'pump']

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <AssetsAndVehicles />
      </ScreenShell>
    </RoleGuard>
  )
}

function serviceTone(days: number): { label: string; color: string } {
  if (days < 0) return { label: `Huduma imechelewa siku ${Math.abs(days)}`, color: colors.danger }
  if (days === 0) return { label: 'Huduma sasa', color: colors.warn }
  if (days <= 7) return { label: `Huduma baada ya siku ${days}`, color: colors.warn }
  return { label: `Huduma baada ya siku ${days}`, color: colors.success }
}

function AssetsAndVehicles(): JSX.Element {
  const [filter, setFilter] = useState<AssetKind | 'all'>('all')
  const [opened, setOpened] = useState<string | null>(null)

  const visible = useMemo<ReadonlyArray<Asset>>(
    () => (filter === 'all' ? ASSETS : ASSETS.filter((a) => a.kind === filter)),
    [filter]
  )

  const fleet = useMemo(() => {
    const total = visible.length
    const avg = total === 0 ? 0 : Math.round(visible.reduce((acc, a) => acc + a.utilizationPct, 0) / total)
    const dueSoon = visible.filter((a) => a.serviceDueInDays <= 7).length
    return { total, avg, dueSoon }
  }, [visible])

  const open = useCallback((id: string): void => {
    setOpened((current) => (current === id ? null : id))
  }, [])

  return (
    <View>
      <Section title={`Mali ${fleet.total} - Wastani wa matumizi ${fleet.avg}% - ${fleet.dueSoon} zinahitaji huduma`}>
        <View style={styles.filterRow}>
          {FILTERS.map((k) => (
            <Pressable
              key={k}
              accessibilityRole="button"
              accessibilityLabel={`Chuja ${k}`}
              onPress={() => setFilter(k)}
              style={[styles.chip, filter === k && styles.chipActive]}
            >
              <Text style={[styles.chipLabel, filter === k && styles.chipLabelActive]}>
                {k === 'all' ? 'Zote' : KIND_LABEL[k]}
              </Text>
            </Pressable>
          ))}
        </View>
      </Section>
      <Section title="Orodha ya mali">
        {visible.map((asset) => {
          const tone = serviceTone(asset.serviceDueInDays)
          const isOpen = opened === asset.id
          const utilBar = Math.max(2, Math.min(100, asset.utilizationPct))
          return (
            <Pressable
              key={asset.id}
              accessibilityRole="button"
              accessibilityLabel={`Onyesha ${asset.label}`}
              onPress={() => open(asset.id)}
              style={[styles.row, isOpen && styles.rowOpen]}
            >
              <View style={styles.rowHeader}>
                <Text style={styles.rowLabel}>{asset.label}</Text>
                <Text style={styles.rowUtil}>{asset.utilizationPct}%</Text>
              </View>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${utilBar}%` }]} />
              </View>
              <Text style={[styles.serviceLine, { color: tone.color }]}>{tone.label}</Text>
              {isOpen ? (
                <View style={styles.detail}>
                  <Text style={styles.detailLine}>Aina: {KIND_LABEL[asset.kind]}</Text>
                  <Text style={styles.detailLine}>Mgodi: {asset.site}</Text>
                  <Text style={styles.detailLine}>Kitambulisho: {asset.id}</Text>
                </View>
              ) : null}
            </Pressable>
          )
        })}
      </Section>
    </View>
  )
}

const styles = StyleSheet.create({
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1
  },
  chipActive: { backgroundColor: colors.gold, borderColor: colors.goldDark },
  chipLabel: { color: colors.textMuted, fontSize: fontSize.caption, fontWeight: '600' },
  chipLabelActive: { color: colors.earth900 },
  row: {
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm
  },
  rowOpen: { borderColor: colors.gold, borderWidth: 1 },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { color: colors.text, fontSize: fontSize.lead, fontWeight: '700' },
  rowUtil: { color: colors.goldDark, fontSize: fontSize.h3, fontWeight: '800' },
  barTrack: {
    marginTop: spacing.sm,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.earth100,
    overflow: 'hidden'
  },
  barFill: { height: '100%', backgroundColor: colors.gold },
  serviceLine: { marginTop: spacing.sm, fontSize: fontSize.body, fontWeight: '600' },
  detail: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopColor: colors.border, borderTopWidth: 1 },
  detailLine: { color: colors.text, fontSize: fontSize.body, marginTop: spacing.xs }
})
