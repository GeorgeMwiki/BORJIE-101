/**
 * Manager onboarding review queue — HR chain L-A (issue #193).
 *
 * Lists candidates who have activated their invitation (status='activated'
 * in workforce_invitations + workforce_status='pending' on users) and
 * lets the manager approve / reject each. Backend:
 *   GET  /api/v1/workforce/openings/:id/candidates
 *   POST /api/v1/workforce/openings/:id/candidates/:userId/review
 *
 * The queue fans out across every open opening, so a manager sees ALL
 * pending candidates in one list regardless of which opening they applied
 * to. Approve / reject are wired to the review endpoint and invalidate the
 * queue so the row drops out on success.
 */

import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Button } from '../../src/forms/Button'
import { useI18n } from '../../src/i18n/useI18n'
import { ApiError } from '../../src/api/errors'
import {
  listPendingCandidates,
  reviewCandidate,
  type CandidateDecision,
  type PendingCandidate,
} from '../../src/onboarding/managerQueue'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'M-ONB'
const QUEUE_QUERY_KEY = ['workforce', 'onboarding', 'pending-candidates'] as const

export default function OnboardingQueueScreen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <QueueView />
      </ScreenShell>
    </RoleGuard>
  )
}

function QueueView(): JSX.Element {
  const { lang } = useI18n()
  const isSw = lang === 'sw'
  const queryClient = useQueryClient()

  const queue = useQuery<ReadonlyArray<PendingCandidate>, ApiError>({
    queryKey: QUEUE_QUERY_KEY,
    queryFn: ({ signal }) => listPendingCandidates(signal),
  })

  const review = useMutation<
    void,
    ApiError,
    { readonly openingId: string; readonly userId: string; readonly decision: CandidateDecision }
  >({
    mutationFn: (input) => reviewCandidate(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUEUE_QUERY_KEY })
    },
  })

  const candidates = queue.data ?? []
  const reviewing = review.isPending
  const pendingId = review.variables?.userId ?? null

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

      {review.isError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>
            {review.error instanceof Error
              ? review.error.message
              : isSw
                ? 'Hatua imeshindwa'
                : 'Review failed'}
          </Text>
        </View>
      ) : null}

      <Section title={isSw ? 'Foleni ya idhini' : 'Approval queue'}>
        {queue.isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.text} />
          </View>
        ) : queue.isError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>
              {queue.error instanceof Error
                ? queue.error.message
                : isSw
                  ? 'Imeshindwa kupakia wagombea'
                  : 'Failed to load candidates'}
            </Text>
            <Button
              label={isSw ? 'Jaribu tena' : 'Retry'}
              onPress={() => void queue.refetch()}
              variant="ghost"
            />
          </View>
        ) : candidates.length === 0 ? (
          <Text style={styles.empty}>
            {isSw
              ? 'Hakuna wagombea kwa sasa.'
              : 'No candidates waiting right now.'}
          </Text>
        ) : (
          candidates.map((candidate) => {
            const busy = reviewing && pendingId === candidate.id
            return (
              <View key={candidate.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{candidate.displayName}</Text>
                  <Text style={styles.cardSubtitle}>
                    {candidate.openingTitle}
                  </Text>
                </View>
                <View style={styles.actions}>
                  <Button
                    label={isSw ? 'Kataa' : 'Reject'}
                    onPress={() =>
                      review.mutate({
                        openingId: candidate.openingId,
                        userId: candidate.id,
                        decision: 'reject',
                      })
                    }
                    variant="ghost"
                    disabled={busy}
                  />
                  <Button
                    label={isSw ? 'Kubali' : 'Approve'}
                    onPress={() =>
                      review.mutate({
                        openingId: candidate.openingId,
                        userId: candidate.id,
                        decision: 'approve',
                      })
                    }
                    disabled={busy}
                  />
                </View>
              </View>
            )
          })
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
  loadingBox: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  errorBox: {
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: '#fde8e8',
    gap: spacing.sm,
  },
  errorText: { color: '#b91c1c', fontSize: fontSize.body },
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
