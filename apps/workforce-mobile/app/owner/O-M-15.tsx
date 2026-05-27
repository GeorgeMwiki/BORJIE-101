import { useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { BigNumber } from '../../src/components/StubBlocks'
import { RoleGuard } from '../../src/components/RoleGuard'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-15'

type Severity = 'high' | 'medium' | 'low'

interface CriticalControl {
  id: string
  name: string
  cleared: boolean
  lastCheck: string
  severity: Severity
}

interface IncidentRow {
  id: string
  kind: string
  detail: string
  dateLabel: string
  severity: Severity
}

const CONTROLS: ReadonlyArray<CriticalControl> = [
  { id: 'pit-slope', name: 'Mteremko wa shimo', cleared: false, lastCheck: 'Mei 22', severity: 'high' },
  { id: 'gas-monitor', name: 'Kifaa cha kupima gesi', cleared: true, lastCheck: 'Mei 26', severity: 'high' },
  { id: 'fire-suppression', name: 'Mfumo wa kuzima moto', cleared: true, lastCheck: 'Mei 25', severity: 'medium' },
  { id: 'lockout', name: 'Lockout / Tagout', cleared: false, lastCheck: 'Mei 21', severity: 'high' },
  { id: 'first-aid', name: 'Kituo cha huduma ya kwanza', cleared: false, lastCheck: 'Mei 20', severity: 'medium' },
  { id: 'ppe-audit', name: 'Ukaguzi wa PPE', cleared: true, lastCheck: 'Mei 26', severity: 'low' }
]

const INCIDENTS: ReadonlyArray<IncidentRow> = [
  { id: 'i1', kind: 'Near-miss', detail: 'Mteremko wa shimo - Geita', dateLabel: 'Mei 22', severity: 'high' },
  { id: 'i2', kind: 'Jeraha dogo', detail: 'Mkono - Excav-2', dateLabel: 'Mei 18', severity: 'medium' },
  { id: 'i3', kind: 'Spill', detail: 'Mafuta L 12 - Generator', dateLabel: 'Mei 14', severity: 'low' }
]

const SEVERITY_COLOR: Readonly<Record<Severity, string>> = {
  high: colors.danger,
  medium: colors.warn,
  low: colors.success
}

const SEVERITY_LABEL: Readonly<Record<Severity, string>> = {
  high: 'Juu',
  medium: 'Kati',
  low: 'Chini'
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <SafetyAndEhs />
      </ScreenShell>
    </RoleGuard>
  )
}

function SafetyAndEhs(): JSX.Element {
  const [overrides, setOverrides] = useState<Readonly<Record<string, boolean>>>({})

  const status = useMemo(() => {
    return CONTROLS.map((c) => ({
      ...c,
      cleared: overrides[c.id] ?? c.cleared
    }))
  }, [overrides])

  const openHigh = useMemo(
    () => status.filter((c) => !c.cleared && c.severity === 'high').length,
    [status]
  )

  const totalOpen = useMemo(() => status.filter((c) => !c.cleared).length, [status])

  const toggle = useCallback((id: string, current: boolean): void => {
    setOverrides((prev) => ({ ...prev, [id]: !current }))
  }, [])

  return (
    <View>
      <Section title="Vidhibiti muhimu vilivyo wazi">
        <View style={styles.heroRow}>
          <View style={styles.heroBox}>
            <BigNumber
              value={String(openHigh)}
              label="Hatari ya juu wazi"
              caption={openHigh === 0 ? 'Mgodi salama' : 'Hatua zinahitajika'}
            />
          </View>
          <View style={styles.miniBox}>
            <Text style={styles.miniValue}>{totalOpen}</Text>
            <Text style={styles.miniLabel}>Jumla wazi</Text>
          </View>
        </View>
      </Section>
      <Section title="Vidhibiti">
        {status.map((c) => (
          <Pressable
            key={c.id}
            accessibilityRole="button"
            accessibilityLabel={`Geuza ${c.name}`}
            onPress={() => toggle(c.id, c.cleared)}
            style={[styles.control, { borderLeftColor: SEVERITY_COLOR[c.severity] }]}
          >
            <View style={styles.controlHeader}>
              <Text style={styles.controlName}>{c.name}</Text>
              <View style={[styles.statusDot, c.cleared ? styles.dotOk : styles.dotOpen]} />
            </View>
            <Text style={styles.controlMeta}>
              Ukaguzi wa mwisho: {c.lastCheck} - Ngazi ya hatari: {SEVERITY_LABEL[c.severity]}
            </Text>
            <Text style={[styles.controlStatus, { color: c.cleared ? colors.success : colors.danger }]}>
              {c.cleared ? 'Imethibitishwa salama' : 'Inahitaji hatua'}
            </Text>
          </Pressable>
        ))}
      </Section>
      <Section title="Matukio ya hivi karibuni">
        {INCIDENTS.map((i) => (
          <View key={i.id} style={[styles.incident, { borderLeftColor: SEVERITY_COLOR[i.severity] }]}>
            <Text style={styles.incidentTitle}>{i.kind}</Text>
            <Text style={styles.incidentMeta}>
              {i.detail} - {i.dateLabel}
            </Text>
          </View>
        ))}
      </Section>
    </View>
  )
}

const styles = StyleSheet.create({
  heroRow: { flexDirection: 'row', gap: spacing.sm },
  heroBox: { flex: 2 },
  miniBox: {
    flex: 1,
    backgroundColor: colors.earth700,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center'
  },
  miniValue: { color: colors.goldLight, fontSize: fontSize.h1, fontWeight: '800' },
  miniLabel: { color: colors.earth100, fontSize: fontSize.caption, marginTop: spacing.xs },
  control: {
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 4
  },
  controlHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  controlName: { color: colors.text, fontSize: fontSize.lead, fontWeight: '700' },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  dotOk: { backgroundColor: colors.success },
  dotOpen: { backgroundColor: colors.danger },
  controlMeta: { color: colors.textMuted, fontSize: fontSize.body, marginTop: spacing.xs },
  controlStatus: { fontSize: fontSize.body, fontWeight: '600', marginTop: spacing.xs },
  incident: {
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 4
  },
  incidentTitle: { color: colors.text, fontSize: fontSize.lead, fontWeight: '700' },
  incidentMeta: { color: colors.textMuted, fontSize: fontSize.body, marginTop: spacing.xs }
})
