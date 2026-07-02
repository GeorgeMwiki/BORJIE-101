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
import { useI18n } from '../../../src/i18n/useI18n'
import { pickStrings, type StringDict } from '../../../src/i18n'
import {
  severityLabel,
  opportunityKindLabel,
  riskKindLabel,
} from '../../../src/i18n/enumLabels'
import { colors } from '../../../src/theme/colors'
import { fontSize, radius, spacing } from '../../../src/theme/spacing'
import { formatDateTime, formatInteger } from '../../../src/home/owner/format'
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
          {pickStrings(user.preferredLang).cockpit.ownerOnly}
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
  const { lang, t } = useI18n()
  const copy = t.cockpit
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
        <Text style={styles.muted}>{copy.loading}</Text>
      </View>
    )
  }
  if (query.isError) {
    return (
      <View style={styles.loading}>
        <Text style={styles.error}>{copy.loadFailed}</Text>
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
          <Text style={styles.bannerText}>{copy.emptyBanner}</Text>
        </View>
      ) : null}

      <Section title={copy.brief}>
        <View style={styles.briefCard}>
          <Text style={styles.briefHeadline}>
            {lang === 'sw' ? data.brief.headlineSw : data.brief.headlineEn}
          </Text>
        </View>
      </Section>

      <Section
        title={copy.decisionsTitle.replace(
          '{{count}}',
          String(data.decisions.length),
        )}
      >
        {data.decisions.length === 0 ? (
          <Text style={styles.muted}>{copy.noDecisions}</Text>
        ) : (
          data.decisions.slice(0, 5).map((decision) => (
            <DecisionRow key={decision.id} decision={decision} lang={lang} t={t} />
          ))
        )}
      </Section>

      <Section
        title={copy.opportunitiesTitle.replace(
          '{{count}}',
          String(data.opportunities.length),
        )}
      >
        {data.opportunities.length === 0 ? (
          <Text style={styles.muted}>{copy.noOpportunities}</Text>
        ) : (
          data.opportunities.slice(0, 5).map((opportunity) => (
            <OpportunityRow
              key={opportunity.id}
              opportunity={opportunity}
              lang={lang}
              t={t}
            />
          ))
        )}
      </Section>

      <Section
        title={copy.risksTitle.replace('{{count}}', String(data.risks.length))}
      >
        {data.risks.length === 0 ? (
          <Text style={styles.muted}>{copy.noRisks}</Text>
        ) : (
          data.risks.slice(0, 5).map((risk) => (
            <RiskRow key={risk.id} risk={risk} t={t} />
          ))
        )}
      </Section>

      <Section
        title={copy.remindersTitle.replace(
          '{{count}}',
          String(data.reminders.length),
        )}
      >
        {data.reminders.length === 0 ? (
          <Text style={styles.muted}>{copy.noReminders}</Text>
        ) : (
          data.reminders.slice(0, 5).map((reminder) => (
            <ReminderRow key={reminder.id} reminder={reminder} lang={lang} />
          ))
        )}
      </Section>
    </ScrollView>
  )
}

function DecisionRow({
  decision,
  lang,
  t,
}: {
  readonly decision: CockpitDecisionSummary
  readonly lang: 'sw' | 'en'
  readonly t: StringDict
}): JSX.Element {
  return (
    <Pressable style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={styles.rowTitle}>{decision.summary}</Text>
        <Text style={styles.severity}>{severityLabel(decision.severity, t)}</Text>
      </View>
      <Text style={styles.muted}>
        {pickStrings(lang).cockpit.raised}{' '}
        {formatDateTime(decision.raisedAt, lang)}
      </Text>
    </Pressable>
  )
}

function OpportunityRow({
  opportunity,
  lang,
  t,
}: {
  readonly opportunity: CockpitOpportunity
  readonly lang: 'sw' | 'en'
  readonly t: StringDict
}): JSX.Element {
  return (
    <Pressable style={styles.row}>
      <Text style={styles.rowTitle}>{opportunity.summary}</Text>
      <Text style={styles.muted}>
        ~TZS {formatInteger(Math.round(opportunity.expectedValueTzs), lang)} ·{' '}
        {opportunityKindLabel(opportunity.kind, t)}
      </Text>
    </Pressable>
  )
}

function RiskRow({
  risk,
  t,
}: {
  readonly risk: CockpitRisk
  readonly t: StringDict
}): JSX.Element {
  return (
    <Pressable style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={styles.rowTitle}>{risk.summary}</Text>
        <Text style={styles.severity}>{severityLabel(risk.severity, t)}</Text>
      </View>
      <Text style={styles.muted}>{riskKindLabel(risk.kind, t)}</Text>
    </Pressable>
  )
}

function ReminderRow({
  reminder,
  lang,
}: {
  readonly reminder: CockpitReminder
  readonly lang: 'sw' | 'en'
}): JSX.Element {
  return (
    <Pressable style={styles.row}>
      <Text style={styles.rowTitle}>{reminder.text}</Text>
      <Text style={styles.muted}>
        {pickStrings(lang).cockpit.due}{' '}
        {formatDateTime(reminder.dueAt, lang)}
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
    color: colors.text,
    fontSize: fontSize.body,
  },
  briefCard: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  briefHeadline: {
    color: colors.text,
    fontSize: fontSize.h3,
    fontWeight: '600',
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
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '500',
    flex: 1,
  },
  severity: {
    color: colors.gold,
    fontSize: fontSize.body,
    fontWeight: '700',
    marginLeft: spacing.sm,
  },
})
