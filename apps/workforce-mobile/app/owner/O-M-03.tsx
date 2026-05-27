import { useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { FingerprintPlaceholder } from '../../src/components/FingerprintPlaceholder'
import { RoleGuard } from '../../src/components/RoleGuard'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-03'

type DecisionStatus = 'pending' | 'approved' | 'rejected'

interface PendingDecision {
  readonly id: string
  readonly title: string
  readonly amountLabel: string
  readonly reasons: ReadonlyArray<string>
  readonly riskLevel: 'low' | 'med' | 'high'
}

const SEED_DECISIONS: ReadonlyArray<PendingDecision> = [
  {
    id: 'd1',
    title: 'Idhinisha upya wa PML 12345 (Geita)',
    amountLabel: 'TZS 2.4M · ada ya leseni',
    reasons: [
      'Leseni inakwisha siku 14',
      'Mapato ya mgodi yamefikia 86% ya lengo',
      'Hakuna deni la mafuta',
      'Mkaguzi ameithibitisha eneo salama'
    ],
    riskLevel: 'low'
  },
  {
    id: 'd2',
    title: 'Kubali oda ya mafuta — Chunya',
    amountLabel: 'TZS 8.4M · lita 4,200',
    reasons: [
      'Stoki ya sasa: siku 3 tu',
      'Bei ni 4% chini ya wastani wa wiki',
      'Mzigo wa kesho unahitaji jenereta-2',
      'Hakuna msururu mwingine wa usambazaji'
    ],
    riskLevel: 'med'
  },
  {
    id: 'd3',
    title: 'Sahihi ya kumaliza shifti B — Mwanza',
    amountLabel: 'Wafanyakazi 12 · masaa 144',
    reasons: [
      'Ripoti za usalama zimekamilika',
      'Mizigo 18 imekaguliwa na meneja',
      'Hakuna jeraha lililoripotiwa',
      'Mafuta yaliyobaki 220 lita'
    ],
    riskLevel: 'low'
  },
  {
    id: 'd4',
    title: 'Idhini ya mkataba mpya wa mnunuzi',
    amountLabel: 'USD 74,000 · ounce 28',
    reasons: [
      'Mnunuzi ni mtu wa zamani (KYC: kijani)',
      'Bei kupita asilimia 2 ya soko',
      'Onyo: malipo ndani ya siku 90',
      'Sheria mpya ya forex inahitaji ukaguzi'
    ],
    riskLevel: 'high'
  }
]

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <PendingDecisionsList />
      </ScreenShell>
    </RoleGuard>
  )
}

function PendingDecisionsList(): JSX.Element {
  const [statuses, setStatuses] = useState<Record<string, DecisionStatus>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const setStatus = useCallback((id: string, status: DecisionStatus): void => {
    setStatuses((current) => ({ ...current, [id]: status }))
  }, [])

  const pendingCount = useMemo<number>(
    () => SEED_DECISIONS.filter((d) => (statuses[d.id] ?? 'pending') === 'pending').length,
    [statuses]
  )

  return (
    <View>
      <Section title="Maamuzi yanayosubiri" hint={`Yamebaki ${pendingCount} kati ya ${SEED_DECISIONS.length}`}>
        {SEED_DECISIONS.map((decision) => {
          const status = statuses[decision.id] ?? 'pending'
          const isOpen = selectedId === decision.id
          return (
            <Pressable
              key={decision.id}
              accessibilityRole="button"
              accessibilityLabel={`Fungua ${decision.title}`}
              onPress={() => setSelectedId(isOpen ? null : decision.id)}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            >
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>{decision.title}</Text>
                <Text style={[styles.badge, badgeStyle(decision.riskLevel)]}>
                  {riskLabel(decision.riskLevel)}
                </Text>
              </View>
              <Text style={styles.cardAmount}>{decision.amountLabel}</Text>
              {isOpen ? (
                <View style={styles.reasons}>
                  {decision.reasons.map((reason, idx) => (
                    <Text key={`${decision.id}-r-${idx}`} style={styles.reason}>
                      {idx + 1}. {reason}
                    </Text>
                  ))}
                  <View style={styles.actions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Idhinisha"
                      onPress={() => setStatus(decision.id, 'approved')}
                      style={({ pressed }) => [styles.actionApprove, pressed && styles.actionPressed]}
                    >
                      <Text style={styles.actionLabel}>Idhinisha</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Kataa"
                      onPress={() => setStatus(decision.id, 'rejected')}
                      style={({ pressed }) => [styles.actionReject, pressed && styles.actionPressed]}
                    >
                      <Text style={styles.actionLabel}>Kataa</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Text style={styles.cardHint}>Bonyeza kuona sababu 4 · {statusLabel(status)}</Text>
              )}
            </Pressable>
          )
        })}
      </Section>
      <Section title="Saini ya kidole" hint="Thibitisha maamuzi yote kwa biometrics">
        <FingerprintPlaceholder label="Saini hapa kumaliza" />
      </Section>
    </View>
  )
}

function riskLabel(risk: 'low' | 'med' | 'high'): string {
  if (risk === 'high') return 'Hatari kubwa'
  if (risk === 'med') return 'Hatari ya kati'
  return 'Hatari ndogo'
}

function statusLabel(status: DecisionStatus): string {
  if (status === 'approved') return 'Imeidhinishwa'
  if (status === 'rejected') return 'Imekataliwa'
  return 'Bado inasubiri'
}

function badgeStyle(risk: 'low' | 'med' | 'high'): { backgroundColor: string; color: string } {
  if (risk === 'high') return { backgroundColor: colors.danger, color: colors.textInverse }
  if (risk === 'med') return { backgroundColor: colors.warn, color: colors.textInverse }
  return { backgroundColor: colors.success, color: colors.textInverse }
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border
  },
  cardPressed: {
    backgroundColor: colors.earth100
  },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  cardTitle: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '700',
    flex: 1,
    paddingRight: spacing.sm
  },
  cardAmount: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  cardHint: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.sm,
    fontStyle: 'italic'
  },
  badge: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    overflow: 'hidden'
  },
  reasons: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopColor: colors.border,
    borderTopWidth: 1
  },
  reason: {
    color: colors.text,
    fontSize: fontSize.body,
    marginBottom: spacing.xs
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md
  },
  actionApprove: {
    flex: 1,
    backgroundColor: colors.success,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center'
  },
  actionReject: {
    flex: 1,
    backgroundColor: colors.danger,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center'
  },
  actionPressed: {
    opacity: 0.8
  },
  actionLabel: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: fontSize.body
  }
})
