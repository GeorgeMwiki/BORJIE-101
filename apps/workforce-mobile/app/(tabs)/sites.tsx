import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { Link } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList, type PlaceholderItem } from '../../src/components/PlaceholderList'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { useAuth } from '../../src/auth/useAuth'
import { useI18n } from '../../src/i18n/useI18n'
import { miningApi } from '../../src/api/client'
import { ApiError, isNetworkError } from '../../src/api/errors'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const COPY = Object.freeze({
  sectionAll: 'Migodi yote',
  loading: 'Inapakia migodi…',
  errorInline: 'Ombi la migodi limeshindwa kuthibitishwa.',
  emptyHint: 'Hakuna migodi iliyosajiliwa kwenye akaunti yako bado.',
  sectionRelated: 'Skrini zinazohusiana',
  unknownMineral: 'Madini hayajulikani'
})

// Map the site `status` enum (active|paused|abandoned|under_rehab) onto a
// short Swahili label for the secondary line. Locale-pure: this screen is
// Swahili-first; English never appears.
const STATUS_LABEL: Readonly<Record<string, string>> = {
  active: 'hai',
  paused: 'imesimama',
  abandoned: 'imeachwa',
  under_rehab: 'inakarabatiwa'
}

interface SiteRow {
  readonly id: string
  readonly name: string
  readonly mineral: string
  readonly phase: string
  readonly status: string
}

interface SitesListResponse {
  readonly success: boolean
  readonly data?: ReadonlyArray<SiteRow>
  readonly error?: { code?: string; message?: string }
}

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status
}

function toPlaceholderItem(site: SiteRow): PlaceholderItem {
  const mineral = site.mineral.length > 0 ? site.mineral : COPY.unknownMineral
  return {
    id: site.id,
    primary: `${site.name} · ${mineral}`,
    secondary: `${site.phase} · ${statusLabel(site.status)}`
  }
}

function isBackendUnavailable(error: unknown): boolean {
  if (isNetworkError(error)) return true
  if (error instanceof ApiError) return error.status >= 500 || error.status === 503
  return false
}

export default function SitesTab(): JSX.Element {
  const { user } = useAuth()
  const { screen } = useI18n()
  const screenId = user?.role === 'owner' ? 'O-M-04' : 'W-M-19'

  return (
    <ScreenShell screenId={screenId}>
      <Section title={COPY.sectionAll}>
        <SitesList />
      </Section>
      <Section title={COPY.sectionRelated}>
        <View style={styles.grid}>
          {['O-M-05', 'O-M-06', 'W-M-02', 'W-M-19'].map((id) => (
            <Link key={id} href={hrefFor(id)} asChild>
              <Pressable style={({ pressed }) => [styles.chip, pressed ? styles.chipPressed : null]}>
                <Text style={styles.chipCode}>{id}</Text>
                <Text style={styles.chipTitle} numberOfLines={2}>
                  {screen(id).title}
                </Text>
              </Pressable>
            </Link>
          ))}
        </View>
      </Section>
    </ScreenShell>
  )
}

function SitesList(): JSX.Element {
  const query = useQuery<ReadonlyArray<SiteRow>, Error>({
    queryKey: ['mining', 'sites'],
    queryFn: async ({ signal }) => {
      const response = await miningApi.get<SitesListResponse>('/sites', { signal })
      if (!response.success || !response.data) {
        throw new Error(response.error?.message ?? COPY.errorInline)
      }
      return response.data
    }
  })

  if (query.isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.gold} />
        <Text style={styles.loadingLabel}>{COPY.loading}</Text>
      </View>
    )
  }

  if (query.isError) {
    return isBackendUnavailable(query.error) ? (
      <PreviewBanner kind="env-missing" />
    ) : (
      <Text style={styles.errorInline}>{COPY.errorInline}</Text>
    )
  }

  if (query.data.length === 0) {
    return (
      <View>
        <PreviewBanner kind="no-data" />
        <Text style={styles.emptyHint}>{COPY.emptyHint}</Text>
      </View>
    )
  }

  return <PlaceholderList items={query.data.map(toPlaceholderItem)} />
}

function hrefFor(id: string): string {
  return id.startsWith('O-M-') ? `/owner/${id}` : `/worker/${id}`
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    paddingVertical: spacing.xl
  },
  loadingLabel: {
    color: colors.textMuted,
    marginTop: spacing.sm,
    fontSize: fontSize.body
  },
  errorInline: {
    color: colors.danger,
    fontSize: fontSize.body,
    fontWeight: '600',
    marginVertical: spacing.md
  },
  emptyHint: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  chip: {
    width: '48%',
    padding: spacing.lg,
    backgroundColor: colors.earth700,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)'
  },
  chipPressed: {
    backgroundColor: colors.earth500,
    transform: [{ scale: 0.98 }]
  },
  chipCode: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase'
  },
  chipTitle: {
    color: colors.text,
    fontSize: fontSize.body,
    marginTop: spacing.xs,
    fontWeight: '600'
  }
})
