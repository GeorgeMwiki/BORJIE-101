import { useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Button } from '../../src/forms/Button'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-06'
const HISTORY_LIMIT = 10

interface Scoop {
  readonly id: string
  readonly atISO: string
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
  const [scoops, setScoops] = useState<ReadonlyArray<Scoop>>([])

  const onTap = useCallback((): void => {
    const next: Scoop = {
      id: `s-${Date.now()}`,
      atISO: new Date().toISOString()
    }
    setScoops((prev) => [next, ...prev])
  }, [])

  const onUndo = useCallback((): void => {
    setScoops((prev) => prev.slice(1))
  }, [])

  const total = scoops.length
  const lastTime = useMemo(() => (scoops[0] ? formatHMS(scoops[0].atISO) : '—'), [scoops])
  const recent = scoops.slice(0, HISTORY_LIMIT)

  return (
    <View>
      <Section title="Hesabu ya leo" hint="Bonyeza kitufe kikubwa kwa kila scoop">
        <View style={styles.countBox}>
          <Text style={styles.countValue}>{total}</Text>
          <Text style={styles.countLabel}>Scoops</Text>
          <Text style={styles.countCaption}>Scoop ya mwisho: {lastTime}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ongeza scoop moja"
          onPress={onTap}
          style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        >
          <Text style={styles.fabPlus}>+</Text>
          <Text style={styles.fabLabel}>SCOOP</Text>
        </Pressable>
        <View style={styles.undoRow}>
          <Button
            label="Tengua mwisho"
            variant="ghost"
            onPress={onUndo}
            disabled={total === 0}
          />
        </View>
      </Section>
      <Section title={`Historia ya hivi karibuni (${recent.length}/${HISTORY_LIMIT})`}>
        {recent.length === 0 ? (
          <Text style={styles.muted}>Bado hujahesabu scoop. Bonyeza kitufe juu.</Text>
        ) : (
          recent.map((s, idx) => (
            <View key={s.id} style={styles.histRow}>
              <Text style={styles.histIndex}>#{total - idx}</Text>
              <Text style={styles.histTime}>{formatHMS(s.atISO)}</Text>
            </View>
          ))
        )}
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
  undoRow: {
    marginTop: spacing.md
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
  }
})
