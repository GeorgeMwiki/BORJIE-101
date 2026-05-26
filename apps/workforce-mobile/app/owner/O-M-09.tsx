import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
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
import { groupByBucket, useLicences } from '../../src/owner/useLicences'
import type { Licence, LicenceBucket } from '../../src/owner/types'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-09'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID} scroll={false}>
        <LicenceCalendarView />
      </ScreenShell>
    </RoleGuard>
  )
}

function LicenceCalendarView(): JSX.Element {
  const { t } = useI18n()
  const query = useLicences()
  const [refreshing, setRefreshing] = useState<boolean>(false)

  const onRefresh = useCallback(async (): Promise<void> => {
    setRefreshing(true)
    try {
      await query.refetch()
    } finally {
      setRefreshing(false)
    }
  }, [query])

  const onRenew = useCallback((licence: Licence): void => {
    // TODO(#44): route to renewal action flow once the licence-renewal
    // screen ships. For now we log so the wiring is exercised.
    console.error('Renewal requested for', licence.pmlNumber)
  }, [])

  if (query.isPending) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.gold} />
        <Text style={styles.loadingText}>{t.licenceCalendar.loading}</Text>
      </View>
    )
  }

  if (query.isError) {
    return (
      <Section title={t.common.errorGeneric}>
        <Text style={styles.errorText}>{t.licenceCalendar.loading}</Text>
      </Section>
    )
  }

  const buckets = groupByBucket(query.data.licences)
  return (
    <ScrollView
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          tintColor={colors.gold}
        />
      }
      contentContainerStyle={styles.scroll}
    >
      <BucketSection
        title={t.licenceCalendar.t7}
        bucket="t7"
        licences={buckets.t7}
        renewLabel={t.licenceCalendar.renewAction}
        daysLeftLabel={t.licenceCalendar.daysLeft}
        emptyLabel={t.licenceCalendar.empty}
        onRenew={onRenew}
      />
      <BucketSection
        title={t.licenceCalendar.t30}
        bucket="t30"
        licences={buckets.t30}
        renewLabel={t.licenceCalendar.renewAction}
        daysLeftLabel={t.licenceCalendar.daysLeft}
        emptyLabel={t.licenceCalendar.empty}
        onRenew={onRenew}
      />
      <BucketSection
        title={t.licenceCalendar.t90}
        bucket="t90"
        licences={buckets.t90}
        renewLabel={t.licenceCalendar.renewAction}
        daysLeftLabel={t.licenceCalendar.daysLeft}
        emptyLabel={t.licenceCalendar.empty}
        onRenew={onRenew}
      />
    </ScrollView>
  )
}

interface BucketSectionProps {
  title: string
  bucket: LicenceBucket
  licences: ReadonlyArray<Licence>
  renewLabel: string
  daysLeftLabel: string
  emptyLabel: string
  onRenew: (licence: Licence) => void
}

function BucketSection({
  title,
  bucket,
  licences,
  renewLabel,
  daysLeftLabel,
  emptyLabel,
  onRenew
}: BucketSectionProps): JSX.Element {
  return (
    <Section title={title}>
      {licences.length === 0 ? (
        <Text style={styles.empty}>{emptyLabel}</Text>
      ) : (
        licences.map((licence) => (
          <Pressable
            key={licence.id}
            accessibilityRole="button"
            accessibilityLabel={renewLabel}
            onPress={() => onRenew(licence)}
            style={[styles.card, BUCKET_STYLES[bucket]]}
          >
            <View>
              <Text style={styles.cardTitle}>{licence.pmlNumber}</Text>
              <Text style={styles.cardSite}>{licence.siteName}</Text>
            </View>
            <View style={styles.cardRight}>
              <Text style={styles.cardDays}>{licence.daysLeft}</Text>
              <Text style={styles.cardDaysLabel}>{daysLeftLabel}</Text>
            </View>
          </Pressable>
        ))
      )}
    </Section>
  )
}

const BUCKET_STYLES: Readonly<Record<LicenceBucket, { borderLeftColor: string; backgroundColor: string }>> = {
  t7: { borderLeftColor: colors.danger, backgroundColor: colors.surfaceAlt },
  t30: { borderLeftColor: colors.warn, backgroundColor: colors.surfaceAlt },
  t90: { borderLeftColor: colors.success, backgroundColor: colors.surfaceAlt },
  expired: { borderLeftColor: colors.earth900, backgroundColor: colors.surfaceAlt }
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    paddingBottom: spacing.xl
  },
  loading: {
    alignItems: 'center',
    padding: spacing.xl
  },
  loadingText: {
    color: colors.textMuted,
    marginTop: spacing.sm,
    fontSize: fontSize.body
  },
  errorText: {
    color: colors.danger
  },
  card: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderLeftWidth: 6,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm
  },
  cardTitle: {
    color: colors.earth900,
    fontSize: fontSize.h3,
    fontWeight: '700'
  },
  cardSite: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  cardRight: {
    alignItems: 'flex-end'
  },
  cardDays: {
    color: colors.earth900,
    fontSize: 28,
    fontWeight: '800'
  },
  cardDaysLabel: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    textTransform: 'uppercase',
    fontWeight: '700'
  },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.body
  }
})
