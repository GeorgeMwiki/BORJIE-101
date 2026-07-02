import { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { miningApi } from '../../src/api/client'
import { ApiError } from '../../src/api/errors'
import { useI18n } from '../../src/i18n/useI18n'
import { formatInteger } from '../../src/i18n/locale-format'
import type { Lang } from '../../src/auth/types'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-20'

type Om20Copy = ReturnType<typeof useI18n>['t']['ownerScreens']['om20']

type MineralFilter = 'all' | 'gold' | 'copper' | 'tanzanite' | 'coal' | 'other'

const FILTER_ORDER: ReadonlyArray<{ kind: MineralFilter; queryValue?: string }> = [
  { kind: 'all' },
  { kind: 'gold', queryValue: 'gold' },
  { kind: 'copper', queryValue: 'copper' },
  { kind: 'tanzanite', queryValue: 'tanzanite' },
  { kind: 'coal', queryValue: 'coal' },
  { kind: 'other' }
]

function filterLabel(kind: MineralFilter, copy: Om20Copy): string {
  if (kind === 'all') return copy.filterAll
  if (kind === 'gold') return copy.filterGold
  if (kind === 'copper') return copy.filterCopper
  if (kind === 'tanzanite') return copy.filterTanzanite
  if (kind === 'coal') return copy.filterCoal
  return copy.filterOther
}

interface ListingRow {
  readonly id: string
  readonly tenantId: string
  readonly title: string
  readonly description?: string | null
  readonly category: string
  readonly visibility: string
  readonly status: string
  readonly priceTzs?: string | null
  readonly priceUnit?: string | null
  readonly attributes: Record<string, unknown>
  readonly createdAt: string
}

interface ListingsResponse {
  readonly success: true
  readonly data: ReadonlyArray<ListingRow>
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function isVerified(attributes: Record<string, unknown>): boolean {
  const value = attributes.verified
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.toLowerCase() === 'true'
  return false
}

function formatPrice(priceTzs: string | null | undefined, unit: string | null | undefined, currencyCode: string, lang: Lang): string {
  if (priceTzs == null) return ''
  const parsed = Number(priceTzs)
  if (!Number.isFinite(parsed)) return ''
  const tail = unit ? ` / ${unit}` : ''
  return `${currencyCode} ${formatInteger(Math.round(parsed), lang)}${tail}`
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <MarketplaceView />
      </ScreenShell>
    </RoleGuard>
  )
}

function MarketplaceView(): JSX.Element {
  const { t, lang } = useI18n()
  const copy = t.ownerScreens.om20
  const [filter, setFilter] = useState<MineralFilter>('all')
  const [verifiedOnly, setVerifiedOnly] = useState<boolean>(false)

  const queryKey = useMemo(() => ['mining', 'marketplace', 'listings', filter] as const, [filter])

  const listingsQuery = useQuery<ReadonlyArray<ListingRow>, ApiError>({
    queryKey,
    queryFn: async ({ signal }) => {
      const queryParams: Record<string, string> = {}
      const filterDef = FILTER_ORDER.find((f) => f.kind === filter)
      if (filterDef?.queryValue) {
        queryParams.mineral = filterDef.queryValue
      }
      const response = await miningApi.get<ListingsResponse>('/marketplace/listings', {
        signal,
        query: queryParams
      })
      return response.data
    }
  })

  const visible = useMemo<ReadonlyArray<ListingRow>>(() => {
    const rows = listingsQuery.data ?? []
    if (!verifiedOnly) return rows
    return rows.filter((l) => isVerified(l.attributes))
  }, [listingsQuery.data, verifiedOnly])

  if (listingsQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.goldDark} />
        <Text style={styles.loadingLabel}>{copy.loading}</Text>
      </View>
    )
  }

  if (listingsQuery.isError) {
    return <PreviewBanner kind={isOfflineError(listingsQuery.error) ? 'offline' : 'env-missing'} />
  }

  const data = listingsQuery.data ?? []
  if (data.length === 0) {
    return <PreviewBanner kind="no-data" />
  }

  return (
    <View>
      <Section title={copy.filterTitle}>
        <View style={styles.filterRow}>
          {FILTER_ORDER.map((f) => {
            const label = filterLabel(f.kind, copy)
            return (
              <Pressable
                key={f.kind}
                accessibilityRole="button"
                accessibilityLabel={`${copy.filterAccessibilityPrefix} ${label}`}
                onPress={() => setFilter(f.kind)}
                style={[styles.chip, filter === f.kind && styles.chipActive]}
              >
                <Text style={[styles.chipLabel, filter === f.kind && styles.chipLabelActive]}>
                  {label}
                </Text>
              </Pressable>
            )
          })}
        </View>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={copy.verifiedToggleLabel}
          accessibilityState={{ checked: verifiedOnly }}
          onPress={() => setVerifiedOnly((current) => !current)}
          style={styles.verifiedToggle}
        >
          <View style={[styles.checkbox, verifiedOnly && styles.checkboxOn]}>
            {verifiedOnly ? <Text style={styles.checkmark}>OK</Text> : null}
          </View>
          <Text style={styles.verifiedLabel}>{copy.verifiedToggleLabel}</Text>
        </Pressable>
      </Section>
      <Section title={`${copy.resultsPrefix}${visible.length}${copy.resultsSuffix}`}>
        {visible.length === 0 ? (
          <PlaceholderList items={[]} emptyLabel={copy.noListings} />
        ) : (
          <View style={styles.list}>
            {visible.map((l) => {
              const verified = isVerified(l.attributes)
              const location = readString(l.attributes.location) ?? readString(l.attributes.region)
              const rating = readNumber(l.attributes.rating)
              const currency = readString(l.attributes.currency) ?? 'TZS'
              const priceLine = formatPrice(l.priceTzs ?? null, l.priceUnit ?? null, currency, lang)
              return (
                <View key={l.id} style={styles.card}>
                  <View style={styles.cardHead}>
                    <Text style={styles.cardTitle}>{l.title}</Text>
                    {verified ? <Text style={styles.badge}>{copy.badgeVerified}</Text> : null}
                  </View>
                  {location || rating !== null ? (
                    <Text style={styles.cardMeta}>
                      {location ?? ''}
                      {location && rating !== null ? ' · ' : ''}
                      {rating !== null
                        ? `${copy.ratingPrefix}${rating.toFixed(1)}${copy.ratingSuffix}`
                        : ''}
                    </Text>
                  ) : null}
                  {priceLine ? <Text style={styles.cardPrice}>{priceLine}</Text> : null}
                </View>
              )
            })}
          </View>
        )}
      </Section>
    </View>
  )
}

function isOfflineError(error: ApiError | null): boolean {
  return error !== null && error.status === 0
}

const styles = StyleSheet.create({
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  loadingLabel: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.sm
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt
  },
  chipActive: {
    backgroundColor: colors.gold,
    borderColor: colors.goldDark
  },
  chipLabel: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    fontWeight: '600'
  },
  chipLabelActive: {
    color: colors.earth900
  },
  verifiedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    gap: spacing.sm
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center'
  },
  checkboxOn: {
    backgroundColor: colors.success,
    borderColor: colors.success
  },
  checkmark: {
    color: colors.textInverse,
    fontSize: fontSize.caption,
    fontWeight: '700'
  },
  verifiedLabel: {
    color: colors.text,
    fontSize: fontSize.body
  },
  list: {
    gap: spacing.sm
  },
  card: {
    backgroundColor: colors.surfaceAlt,
    padding: spacing.md,
    borderRadius: radius.md
  },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  cardTitle: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600',
    flex: 1
  },
  badge: {
    color: colors.textInverse,
    backgroundColor: colors.success,
    fontSize: fontSize.caption,
    fontWeight: '700',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden'
  },
  cardMeta: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  },
  cardPrice: {
    color: colors.goldDark,
    fontSize: fontSize.body,
    fontWeight: '700',
    marginTop: spacing.sm
  }
})
