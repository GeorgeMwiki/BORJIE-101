import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { Link } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList, type PlaceholderItem } from '../../src/components/PlaceholderList'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { useAuth } from '../../src/auth/useAuth'
import { useI18n } from '../../src/i18n/useI18n'
import type { StringDict } from '../../src/i18n'
import { sitePhaseLabel } from '../../src/i18n/enumLabels'
import { miningApi } from '../../src/api/client'
import { ApiError, isNetworkError } from '../../src/api/errors'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

type Lang = 'sw' | 'en'

interface SitesCopy {
  readonly sectionAll: string
  readonly loading: string
  readonly errorInline: string
  readonly emptyHint: string
  readonly sectionRelated: string
  readonly unknownMineral: string
}

// Per-locale copy. The active language follows the worker's preference
// (default `en`); the toggle is absolute — when `en` is active zero
// Swahili appears on this screen, and vice versa.
const COPY: Readonly<Record<Lang, SitesCopy>> = {
  sw: {
    sectionAll: 'Migodi yote',
    loading: 'Inapakia migodi…',
    errorInline: 'Ombi la migodi limeshindwa kuthibitishwa.',
    emptyHint: 'Hakuna migodi iliyosajiliwa kwenye akaunti yako bado.',
    sectionRelated: 'Skrini zinazohusiana',
    unknownMineral: 'Madini hayajulikani'
  },
  en: {
    sectionAll: 'All sites',
    loading: 'Loading sites…',
    errorInline: 'The sites request could not be verified.',
    emptyHint: 'No sites are registered on your account yet.',
    sectionRelated: 'Related screens',
    unknownMineral: 'Mineral unknown'
  }
}

// Map the site `status` enum (active|paused|abandoned|under_rehab) onto a
// short label for the secondary line, keyed by the active locale.
const STATUS_LABEL: Readonly<Record<Lang, Readonly<Record<string, string>>>> = {
  sw: {
    active: 'hai',
    paused: 'imesimama',
    abandoned: 'imeachwa',
    under_rehab: 'inakarabatiwa'
  },
  en: {
    active: 'active',
    paused: 'paused',
    abandoned: 'abandoned',
    under_rehab: 'under rehab'
  }
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

function statusLabel(status: string, lang: Lang): string {
  return STATUS_LABEL[lang][status] ?? status
}

function toPlaceholderItem(site: SiteRow, lang: Lang, t: StringDict): PlaceholderItem {
  const mineral = site.mineral.length > 0 ? site.mineral : COPY[lang].unknownMineral
  return {
    id: site.id,
    primary: `${site.name} · ${mineral}`,
    // Both phase and status localize through label maps — neither renders a
    // raw enum token (a raw token under `sw` is language mixing).
    secondary: `${sitePhaseLabel(site.phase, t)} · ${statusLabel(site.status, lang)}`
  }
}

function isBackendUnavailable(error: unknown): boolean {
  if (isNetworkError(error)) return true
  if (error instanceof ApiError) return error.status >= 500 || error.status === 503
  return false
}

export default function SitesTab(): JSX.Element {
  const { user } = useAuth()
  const { screen, lang, t } = useI18n()
  const screenId = user?.role === 'owner' ? 'O-M-04' : 'W-M-19'

  return (
    <ScreenShell screenId={screenId}>
      <Section title={COPY[lang].sectionAll}>
        <SitesList lang={lang} t={t} />
      </Section>
      <Section title={COPY[lang].sectionRelated}>
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

function SitesList({ lang, t }: { readonly lang: Lang; readonly t: StringDict }): JSX.Element {
  const query = useQuery<ReadonlyArray<SiteRow>, Error>({
    queryKey: ['mining', 'sites'],
    queryFn: async ({ signal }) => {
      const response = await miningApi.get<SitesListResponse>('/sites', { signal })
      if (!response.success || !response.data) {
        throw new Error(response.error?.message ?? COPY[lang].errorInline)
      }
      return response.data
    }
  })

  if (query.isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.gold} />
        <Text style={styles.loadingLabel}>{COPY[lang].loading}</Text>
      </View>
    )
  }

  if (query.isError) {
    return isBackendUnavailable(query.error) ? (
      <PreviewBanner kind="env-missing" />
    ) : (
      <Text style={styles.errorInline}>{COPY[lang].errorInline}</Text>
    )
  }

  if (query.data.length === 0) {
    return (
      <View>
        <PreviewBanner kind="no-data" />
        <Text style={styles.emptyHint}>{COPY[lang].emptyHint}</Text>
      </View>
    )
  }

  return <PlaceholderList items={query.data.map((site) => toPlaceholderItem(site, lang, t))} />
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
