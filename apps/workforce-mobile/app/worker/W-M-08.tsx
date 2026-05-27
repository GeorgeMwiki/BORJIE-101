import { useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Button } from '../../src/forms/Button'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-08'

interface ChainStep {
  readonly id: string
  readonly actor: string
  readonly role: string
  readonly atISO: string
}

interface Sample {
  readonly id: string
  readonly tag: string
  readonly weightKg: number
  readonly chain: ReadonlyArray<ChainStep>
}

const SAMPLES: ReadonlyArray<Sample> = [
  {
    id: 'sm-01',
    tag: 'SMP-0421',
    weightKg: 4.2,
    chain: [
      { id: 'c1', actor: 'Asha M.', role: 'Mfanyakazi', atISO: '2026-05-27T07:42:00+03:00' },
      { id: 'c2', actor: 'Juma K.', role: 'Foreman', atISO: '2026-05-27T08:05:00+03:00' }
    ]
  },
  {
    id: 'sm-02',
    tag: 'SMP-0422',
    weightKg: 3.6,
    chain: [
      { id: 'c1', actor: 'Asha M.', role: 'Mfanyakazi', atISO: '2026-05-27T08:11:00+03:00' }
    ]
  },
  {
    id: 'sm-03',
    tag: 'SMP-0423',
    weightKg: 5.1,
    chain: [
      { id: 'c1', actor: 'Salim H.', role: 'Mfanyakazi', atISO: '2026-05-27T08:30:00+03:00' },
      { id: 'c2', actor: 'Juma K.', role: 'Foreman', atISO: '2026-05-27T08:55:00+03:00' },
      { id: 'c3', actor: 'Lab van', role: 'Usafirishaji', atISO: '2026-05-27T09:10:00+03:00' }
    ]
  }
]

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <SampleView />
      </ScreenShell>
    </RoleGuard>
  )
}

function SampleView(): JSX.Element {
  const [activeId, setActiveId] = useState<string>(SAMPLES[0]?.id ?? '')
  const [sealedIds, setSealedIds] = useState<ReadonlyArray<string>>([])

  const active = useMemo(
    () => SAMPLES.find((s) => s.id === activeId) ?? SAMPLES[0],
    [activeId]
  )

  const onSelect = useCallback((id: string): void => {
    setActiveId(id)
  }, [])

  const onSeal = useCallback((): void => {
    if (!active) return
    setSealedIds((prev) => (prev.includes(active.id) ? prev : [...prev, active.id]))
  }, [active])

  if (!active) {
    return (
      <View>
        <Section title="Sampuli">
          <Text style={styles.muted}>Hakuna sampuli.</Text>
        </Section>
      </View>
    )
  }

  const isSealed = sealedIds.includes(active.id)

  return (
    <View>
      <Section title={`Sampuli za leo (${SAMPLES.length})`}>
        {SAMPLES.map((s) => {
          const selected = s.id === activeId
          const sealed = sealedIds.includes(s.id)
          return (
            <Pressable
              key={s.id}
              accessibilityRole="button"
              accessibilityLabel={`Chagua sampuli ${s.tag}`}
              accessibilityState={{ selected }}
              onPress={() => onSelect(s.id)}
              style={({ pressed }) => [
                styles.sampleRow,
                selected && styles.sampleRowSelected,
                pressed && styles.sampleRowPressed
              ]}
            >
              <View style={styles.qr}>
                <Text style={styles.qrText}>QR</Text>
              </View>
              <View style={styles.sampleBody}>
                <Text style={styles.sampleTag}>{s.tag}</Text>
                <Text style={styles.sampleMeta}>Uzito: {s.weightKg.toFixed(1)} kg · {s.chain.length} mikono</Text>
              </View>
              {sealed ? (
                <View style={styles.sealedBadge}>
                  <Text style={styles.sealedBadgeText}>IMEFUNGWA</Text>
                </View>
              ) : null}
            </Pressable>
          )
        })}
      </Section>
      <Section title={`Mlolongo wa udhibiti — ${active.tag}`} hint="Nani alishika sampuli na lini">
        {active.chain.map((step, idx) => (
          <View key={step.id} style={styles.chainRow}>
            <View style={styles.chainDot}>
              <Text style={styles.chainDotText}>{idx + 1}</Text>
            </View>
            <View style={styles.chainBody}>
              <Text style={styles.chainActor}>{step.actor}</Text>
              <Text style={styles.chainMeta}>{step.role} · {formatHM(step.atISO)}</Text>
            </View>
          </View>
        ))}
      </Section>
      <Section title="Funga sampuli">
        <Button
          label={isSealed ? 'Imefungwa salama' : 'Funga Sampuli'}
          onPress={onSeal}
          disabled={isSealed}
        />
      </Section>
    </View>
  )
}

function formatHM(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

const styles = StyleSheet.create({
  muted: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  sampleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    gap: spacing.md
  },
  sampleRowSelected: {
    borderWidth: 2,
    borderColor: colors.gold
  },
  sampleRowPressed: {
    backgroundColor: colors.earth100
  },
  qr: {
    width: 56,
    height: 56,
    backgroundColor: colors.earth900,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm
  },
  qrText: {
    color: colors.goldLight,
    fontSize: fontSize.lead,
    fontWeight: '800'
  },
  sampleBody: {
    flex: 1
  },
  sampleTag: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  sampleMeta: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  sealedBadge: {
    backgroundColor: colors.success,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm
  },
  sealedBadgeText: {
    color: colors.textInverse,
    fontSize: fontSize.caption,
    fontWeight: '800',
    letterSpacing: 1
  },
  chainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    gap: spacing.md
  },
  chainDot: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center'
  },
  chainDotText: {
    color: colors.earth900,
    fontWeight: '800',
    fontSize: fontSize.body
  },
  chainBody: {
    flex: 1
  },
  chainActor: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600'
  },
  chainMeta: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  }
})
