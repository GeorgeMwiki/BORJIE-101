import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-04'

type LicenseStatus = 'active' | 'pending' | 'working' | 'expired'

interface MiningLicense {
  readonly id: string
  readonly licenseCode: string
  readonly region: string
  readonly status: LicenseStatus
  readonly hectares: number
  readonly mineral: string
}

const SEED_LICENSES: ReadonlyArray<MiningLicense> = [
  { id: 'l1', licenseCode: 'PML 12345', region: 'Geita', status: 'active', hectares: 8.4, mineral: 'Dhahabu' },
  { id: 'l2', licenseCode: 'PML 67890', region: 'Chunya', status: 'pending', hectares: 6.1, mineral: 'Dhahabu' },
  { id: 'l3', licenseCode: 'PML 24680', region: 'Mwanza', status: 'working', hectares: 9.7, mineral: 'Dhahabu' },
  { id: 'l4', licenseCode: 'PML 13579', region: 'Mererani', status: 'working', hectares: 2.2, mineral: 'Tanzanite' },
  { id: 'l5', licenseCode: 'PML 99001', region: 'Kahama', status: 'expired', hectares: 7.5, mineral: 'Shaba' },
  { id: 'l6', licenseCode: 'PML 55012', region: 'Singida', status: 'active', hectares: 5.0, mineral: 'Dhahabu' }
]

type FilterKey = LicenseStatus | 'all'

const FILTERS: ReadonlyArray<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'Zote' },
  { key: 'active', label: 'Hai' },
  { key: 'working', label: 'Kazi' },
  { key: 'pending', label: 'Subiri' },
  { key: 'expired', label: 'Imekwisha' }
]

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <PortfolioMapView />
      </ScreenShell>
    </RoleGuard>
  )
}

function PortfolioMapView(): JSX.Element {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [selectedId, setSelectedId] = useState<string | null>(SEED_LICENSES[0]?.id ?? null)

  const visible = useMemo<ReadonlyArray<MiningLicense>>(
    () => (filter === 'all' ? SEED_LICENSES : SEED_LICENSES.filter((l) => l.status === filter)),
    [filter]
  )

  const totals = useMemo(() => {
    const counts: Record<LicenseStatus, number> = { active: 0, working: 0, pending: 0, expired: 0 }
    SEED_LICENSES.forEach((l) => {
      counts[l.status] += 1
    })
    return counts
  }, [])

  return (
    <View>
      <Section title="Ramani ya portifolio" hint="Polygons + rangi za hali · bonyeza kuchagua">
        <View style={styles.mapBox}>
          <View style={styles.mapGrid}>
            {SEED_LICENSES.map((license) => (
              <Pressable
                key={license.id}
                accessibilityRole="button"
                accessibilityLabel={`${license.licenseCode} ${license.region}`}
                onPress={() => setSelectedId(license.id)}
                style={({ pressed }) => [
                  styles.polygon,
                  { backgroundColor: statusColor(license.status) },
                  pressed && styles.polygonPressed,
                  selectedId === license.id && styles.polygonSelected
                ]}
              >
                <Text style={styles.polygonLabel}>{license.licenseCode.split(' ')[1]}</Text>
                <Text style={styles.polygonRegion}>{license.region}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.legend}>
            <LegendDot status="active" label={`Hai (${totals.active})`} />
            <LegendDot status="working" label={`Kazi (${totals.working})`} />
            <LegendDot status="pending" label={`Subiri (${totals.pending})`} />
            <LegendDot status="expired" label={`Kwisha (${totals.expired})`} />
          </View>
        </View>
      </Section>
      <Section title="Chuja kwa hali">
        <View style={styles.filterRow}>
          {FILTERS.map((f) => (
            <Pressable
              key={f.key}
              accessibilityRole="button"
              accessibilityLabel={f.label}
              onPress={() => setFilter(f.key)}
              style={({ pressed }) => [
                styles.chip,
                filter === f.key && styles.chipActive,
                pressed && styles.chipPressed
              ]}
            >
              <Text style={[styles.chipLabel, filter === f.key && styles.chipLabelActive]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>
      </Section>
      <Section title={`Migodi (${visible.length})`}>
        {visible.map((license) => (
          <Pressable
            key={license.id}
            accessibilityRole="button"
            accessibilityLabel={license.licenseCode}
            onPress={() => setSelectedId(license.id)}
            style={({ pressed }) => [
              styles.row,
              selectedId === license.id && styles.rowSelected,
              pressed && styles.rowPressed
            ]}
          >
            <View style={[styles.statusDot, { backgroundColor: statusColor(license.status) }]} />
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>
                {license.licenseCode} · {statusLabel(license.status)}
              </Text>
              <Text style={styles.rowMeta}>
                {license.region} · {license.hectares} ha · {license.mineral}
              </Text>
            </View>
          </Pressable>
        ))}
      </Section>
    </View>
  )
}

function LegendDot({ status, label }: { status: LicenseStatus; label: string }): JSX.Element {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: statusColor(status) }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  )
}

function statusColor(status: LicenseStatus): string {
  if (status === 'active') return colors.success
  if (status === 'working') return colors.gold
  if (status === 'pending') return colors.warn
  return colors.danger
}

function statusLabel(status: LicenseStatus): string {
  if (status === 'active') return 'hai'
  if (status === 'working') return 'kazi'
  if (status === 'pending') return 'subiri'
  return 'imekwisha'
}

const styles = StyleSheet.create({
  mapBox: {
    backgroundColor: colors.earth100,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border
  },
  mapGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  polygon: {
    width: '31%',
    minHeight: 70,
    borderRadius: radius.md,
    padding: spacing.sm,
    justifyContent: 'center'
  },
  polygonPressed: {
    opacity: 0.8
  },
  polygonSelected: {
    borderWidth: 3,
    borderColor: colors.earth900
  },
  polygonLabel: {
    color: colors.textInverse,
    fontSize: fontSize.lead,
    fontWeight: '800'
  },
  polygonRegion: {
    color: colors.textInverse,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  },
  legend: {
    marginTop: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: radius.pill
  },
  legendLabel: {
    color: colors.text,
    fontSize: fontSize.caption,
    fontWeight: '600'
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border
  },
  chipActive: {
    backgroundColor: colors.earth700,
    borderColor: colors.earth700
  },
  chipPressed: {
    opacity: 0.7
  },
  chipLabel: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '600'
  },
  chipLabelActive: {
    color: colors.textInverse
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    gap: spacing.md
  },
  rowSelected: {
    borderWidth: 2,
    borderColor: colors.gold
  },
  rowPressed: {
    opacity: 0.85
  },
  statusDot: {
    width: 14,
    height: 14,
    borderRadius: radius.pill
  },
  rowBody: {
    flex: 1
  },
  rowTitle: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  rowMeta: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  }
})
