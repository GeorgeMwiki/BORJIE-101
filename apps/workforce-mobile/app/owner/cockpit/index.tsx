/**
 * Owner-mobile cockpit hub — Roadmap R7.
 *
 * Single mobile-friendly surface that aggregates the owner-web cockpit
 * panels (brief, recent decisions, opportunities, risks, reminders)
 * into a swipe-and-scroll layout. Re-uses the /v1/owner/cockpit/hub
 * endpoint via `useCockpitHub`.
 *
 * Tap targets follow Material 3's 48dp minimum so the surface is usable
 * with gloves on (artisanal-mine ergonomic constraint).
 */

import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Redirect } from 'expo-router'
import { ScreenShell } from '../../../src/components/ScreenShell'
import { Section } from '../../../src/components/Section'
import { useAuth } from '../../../src/auth/useAuth'
import { colors } from '../../../src/theme/colors'
import { fontSize, radius, spacing } from '../../../src/theme/spacing'
import {
  useCockpitHub,
  isEmptyCockpit,
  type CockpitDecisionSummary,
  type CockpitOpportunity,
  type CockpitRisk,
  type CockpitReminder,
} from '../../../src/owner/cockpit/useCockpitHub'

// Screen ID is intentionally NOT registered in
// `src/roles/access.ts` — the cockpit hub is reachable only from
// inside the owner branch (O-M-01 → "Open cockpit hub" link) so the
// owner-role gate flows from the parent screen. Adding a registry
// entry here would step on the mobile zone owner's file; we inline a
// lightweight role check instead.
const SCREEN_ID = 'O-M-01'

export default function CockpitHubScreen(): JSX.Element {
  const { user, ready } = useAuth()
  if (!ready) return <View style={{ flex: 1 }} />
  if (!user) return <Redirect href="/onboarding/role" />
  if (user.role !== 'owner') {
    return (
      <View style={styles.loading}>
        <Text style={styles.error}>
          Cockpit hub is owner-only / Cockpit ni kwa mmiliki tu
        </Text>
      </View>
    )
  }
  return (
    <ScreenShell screenId={SCREEN_ID} scroll={false}>
      <CockpitHubView />
    </ScreenShell>
  )
}

function CockpitHubView(): JSX.Element {
  const query = useCockpitHub()
  const [refreshing, setRefreshing] = useState<boolean>(false)

  const onRefresh = useCallback(async (): Promise<void> => {
    setRefreshing(true)
    try {
      await query.refetch()
    } finally {
      setRefreshing(false)
    }
  }, [query])

  if (query.isPending) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.gold} />
        <Text style={styles.muted}>Loading cockpit… / Inapakia…</Text>
      </View>
    )
  }
  if (query.isError) {
    return (
      <View style={styles.loading}>
        <Text style={styles.error}>
          Cockpit failed to load / Cockpit imeshindwa kupakia
        </Text>
      </View>
    )
  }
  const data = query.data
  const empty = isEmptyCockpit(data)
  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          tintColor={colors.gold}
        />
      }
    >
      {empty ? (
        <View style={styles.bannerEmpty}>
          <Text style={styles.bannerText}>
            No fresh cockpit data yet — pull down to refresh.
          </Text>
          <Text style={styles.bannerHint}>
            Hakuna data mpya bado — vuta chini kuburudisha.
          </Text>
        </View>
      ) : null}

      <Section title="Brief">
        <View style={styles.briefCard}>
          <Text style={styles.briefHeadline}>{data.brief.headlineEn}</Text>
          <Text style={styles.briefHeadlineSw}>{data.brief.headlineSw}</Text>
        </View>
      </Section>

      <Section title={`Recent decisions (${data.decisions.length})`}>
        {data.decisions.length === 0 ? (
          <Text style={styles.muted}>No pending decisions / Hakuna maamuzi yaliyosubiri</Text>
        ) : (
          data.decisions.slice(0, 5).map((decision) => (
            <DecisionRow key={decision.id} decision={decision} />
          ))
        )}
      </Section>

      <Section title={`Opportunities (${data.opportunities.length})`}>
        {data.opportunities.length === 0 ? (
          <Text style={styles.muted}>No fresh opportunities / Hakuna fursa mpya</Text>
        ) : (
          data.opportunities.slice(0, 5).map((opportunity) => (
            <OpportunityRow
              key={opportunity.id}
              opportunity={opportunity}
            />
          ))
        )}
      </Section>

      <Section title={`Risks (${data.risks.length})`}>
        {data.risks.length === 0 ? (
          <Text style={styles.muted}>No active risks / Hakuna hatari za sasa</Text>
        ) : (
          data.risks.slice(0, 5).map((risk) => (
            <RiskRow key={risk.id} risk={risk} />
          ))
        )}
      </Section>

      <Section title={`Reminders (${data.reminders.length})`}>
        {data.reminders.length === 0 ? (
          <Text style={styles.muted}>No reminders / Hakuna ukumbusho</Text>
        ) : (
          data.reminders.slice(0, 5).map((reminder) => (
            <ReminderRow key={reminder.id} reminder={reminder} />
          ))
        )}
      </Section>
    </ScrollView>
  )
}

function DecisionRow({
  decision,
}: {
  readonly decision: CockpitDecisionSummary
}): JSX.Element {
  return (
    <Pressable style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={styles.rowTitle}>{decision.summary}</Text>
        <Text style={styles.severity}>{decision.severity.toUpperCase()}</Text>
      </View>
      <Text style={styles.muted}>
        Raised {new Date(decision.raisedAt).toLocaleString()}
      </Text>
    </Pressable>
  )
}

function OpportunityRow({
  opportunity,
}: {
  readonly opportunity: CockpitOpportunity
}): JSX.Element {
  return (
    <Pressable style={styles.row}>
      <Text style={styles.rowTitle}>{opportunity.summary}</Text>
      <Text style={styles.muted}>
        ~TZS {Math.round(opportunity.expectedValueTzs).toLocaleString()} ·{' '}
        {opportunity.kind}
      </Text>
    </Pressable>
  )
}

function RiskRow({ risk }: { readonly risk: CockpitRisk }): JSX.Element {
  return (
    <Pressable style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={styles.rowTitle}>{risk.summary}</Text>
        <Text style={styles.severity}>{risk.severity.toUpperCase()}</Text>
      </View>
      <Text style={styles.muted}>{risk.kind}</Text>
    </Pressable>
  )
}

function ReminderRow({
  reminder,
}: {
  readonly reminder: CockpitReminder
}): JSX.Element {
  return (
    <Pressable style={styles.row}>
      <Text style={styles.rowTitle}>{reminder.text}</Text>
      <Text style={styles.muted}>
        Due {new Date(reminder.dueAt).toLocaleString()}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    paddingBottom: spacing.xl,
  },
  loading: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  muted: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs,
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.body,
  },
  bannerEmpty: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  bannerText: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
  },
  bannerHint: {
    color: colors.textMuted,
    fontSize: fontSize.bodySm,
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
  briefCard: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  briefHeadline: {
    color: colors.textPrimary,
    fontSize: fontSize.h3,
    fontWeight: '600',
  },
  briefHeadlineSw: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
  row: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    minHeight: 48,
  },
  rowHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: '500',
    flex: 1,
  },
  severity: {
    color: colors.gold,
    fontSize: fontSize.bodySm,
    fontWeight: '700',
    marginLeft: spacing.sm,
  },
})
