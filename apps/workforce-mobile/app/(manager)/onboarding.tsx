/**
 * Manager onboarding review queue — HR chain L-A (issue #193).
 *
 * Lists candidates who have activated their invitation (status='active'
 * in workforce_invitations + workforce_status='pending' on users) and
 * lets the manager approve / reject each. Backend:
 *   POST /api/v1/workforce/openings/:id/candidates/:userId/review
 */

import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Button } from '../../src/forms/Button'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'M-ONB'

interface Candidate {
  readonly id: string
  readonly displayName: string
  readonly openingId: string
  readonly openingTitle: string
}

export default function OnboardingQueueScreen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <QueueView lang="sw" />
      </ScreenShell>
    </RoleGuard>
  )
}

function QueueView({ lang }: { lang: 'sw' | 'en' }): JSX.Element {
  const isSw = lang === 'sw'
  const [candidates] = useState<Candidate[]>([])

  return (
    <View style={styles.root}>
      <Text style={styles.title}>
        {isSw ? 'Wagombea wapya' : 'New candidates'}
      </Text>
      <Text style={styles.subtitle}>
        {isSw
          ? 'Wakubali au wakatae wagombea ili wapate hisa za kazi.'
          : 'Approve or reject candidates so they can join shifts.'}
      </Text>

      <Section title={isSw ? 'Foleni ya idhini' : 'Approval queue'}>
        {candidates.length === 0 ? (
          <Text style={styles.empty}>
            {isSw
              ? 'Hakuna wagombea kwa sasa.'
              : 'No candidates waiting right now.'}
          </Text>
        ) : (
          candidates.map((c) => (
            <View key={c.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{c.displayName}</Text>
                <Text style={styles.cardSubtitle}>{c.openingTitle}</Text>
              </View>
              <View style={styles.actions}>
                <Button label={isSw ? 'Kataa' : 'Reject'} onPress={() => {}} variant="ghost" />
                <Button label={isSw ? 'Kubali' : 'Approve'} onPress={() => {}} />
              </View>
            </View>
          ))
        )}
      </Section>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: spacing.lg, gap: spacing.md },
  title: { color: colors.text, fontSize: fontSize.h2, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: fontSize.body },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    paddingVertical: spacing.lg,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.earth700,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
  },
  cardHeader: { gap: spacing.xs },
  cardTitle: { color: colors.text, fontSize: fontSize.lead, fontWeight: '600' },
  cardSubtitle: { color: colors.textMuted, fontSize: fontSize.body },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
})
