import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { useI18n } from '../../src/i18n/useI18n'
import { useDailyBrief } from '../../src/owner/useDailyBrief'
import type { DailyBriefCard } from '../../src/owner/types'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-01'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID} scroll={false}>
        <DailyBriefView />
      </ScreenShell>
    </RoleGuard>
  )
}

function DailyBriefView(): JSX.Element {
  const { t } = useI18n()
  const query = useDailyBrief()
  const [refreshing, setRefreshing] = useState<boolean>(false)

  const onRefresh = useCallback(async (): Promise<void> => {
    setRefreshing(true)
    try {
      await query.refetch()
    } finally {
      setRefreshing(false)
    }
  }, [query])

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          tintColor={colors.gold}
          title={t.dailyBrief.refresh}
        />
      }
    >
      {query.isPending ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.gold} />
          <Text style={styles.loadingText}>{t.dailyBrief.loading}</Text>
        </View>
      ) : query.isError ? (
        <Section title={t.common.errorGeneric}>
          <Text style={styles.errorText}>{t.dailyBrief.errorBrief}</Text>
        </Section>
      ) : (
        <Section title={t.app.tagline}>
          {query.data.cards.length === 0 ? (
            <Text style={styles.empty}>{t.dailyBrief.empty}</Text>
          ) : (
            query.data.cards.slice(0, 3).map((card) => <BriefCard key={card.id} card={card} />)
          )}
        </Section>
      )}
    </ScrollView>
  )
}

interface BriefCardProps {
  card: DailyBriefCard
}

function BriefCard({ card }: BriefCardProps): JSX.Element {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{card.title}</Text>
      <Text style={styles.cardValue}>{card.value}</Text>
      {card.caption ? <Text style={styles.cardCaption}>{card.caption}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    paddingBottom: spacing.xl
  },
  loading: {
    alignItems: 'center',
    paddingVertical: spacing.xl
  },
  loadingText: {
    color: colors.textMuted,
    marginTop: spacing.sm,
    fontSize: fontSize.body
  },
  errorText: {
    color: colors.danger,
    fontSize: fontSize.body
  },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  card: {
    backgroundColor: colors.earth700,
    padding: spacing.lg,
    borderRadius: radius.md,
    marginBottom: spacing.md
  },
  cardTitle: {
    color: colors.goldLight,
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase'
  },
  cardValue: {
    color: colors.textInverse,
    fontSize: 32,
    fontWeight: '800',
    marginTop: spacing.xs
  },
  cardCaption: {
    color: colors.earth100,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  }
})
