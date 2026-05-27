import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { Button } from '../../src/forms/Button'
import { request } from '../../src/api/client'
import { API_BASE_URL } from '../../src/api/config'
import { ApiError } from '../../src/api/errors'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-24'

const COPY = Object.freeze({
  loading: 'Inapakia mipangilio ya arifa...',
  summaryTitle: 'Muhtasari',
  summaryHint: (count: number): string => `Njia za arifa zilizowashwa: ${count}`,
  quietHoursLabel: (start: string, end: string): string => `Saa za utulivu (${start} - ${end})`,
  quietHoursOn: 'Imewashwa',
  quietHoursOff: 'Imezimwa',
  categories: 'Kategoria',
  categoriesHint: 'Bonyeza njia ili kuzima au kuwasha',
  saveSection: 'Hifadhi mabadiliko',
  save: 'Hifadhi',
  savedNote: (time: string): string => `Imehifadhiwa - ${time}`,
  pending: 'Bado hakuna mabadiliko yaliyohifadhiwa'
})

type Channel = 'push' | 'whatsapp' | 'sms' | 'email'

const CHANNEL_LABELS: Readonly<Record<Channel, string>> = Object.freeze({
  push: 'Push',
  whatsapp: 'WA',
  sms: 'SMS',
  email: 'Barua'
})

const CHANNEL_ORDER: ReadonlyArray<Channel> = ['push', 'whatsapp', 'sms', 'email']

interface CategorySpec {
  readonly id: string
  readonly label: string
  readonly hint: string
}

const CATEGORIES: ReadonlyArray<CategorySpec> = [
  {
    id: 'maamuzi',
    label: 'Maamuzi',
    hint: 'Maamuzi mapya ya AI yanahitaji idhini'
  },
  {
    id: 'pricing',
    label: 'Pricing',
    hint: 'Mabadiliko ya bei ya dhahabu, shaba, tanzanite'
  },
  {
    id: 'safety',
    label: 'Safety',
    hint: 'Matukio ya hatari migodini'
  },
  {
    id: 'compliance',
    label: 'Compliance',
    hint: 'PML, hati za ushuru, ripoti za mdhibiti'
  },
  {
    id: 'crew',
    label: 'Crew',
    hint: 'Ripoti za shifti, mahudhurio, malipo'
  },
  {
    id: 'fx',
    label: 'FX',
    hint: 'TZS-USD-KES rates, USD-cliff alerts'
  }
]

interface NotificationPrefs {
  readonly channels: Readonly<{
    email: boolean
    sms: boolean
    push: boolean
    whatsapp: boolean
  }>
  readonly templates: Readonly<Record<string, boolean>>
  readonly quietHoursStart: string | null
  readonly quietHoursEnd: string | null
  readonly lastSavedAt?: string | null
  readonly updatedAt?: string | null
}

interface PreferencesResponse {
  readonly data?: Partial<NotificationPrefs>
}

const DEFAULT_QUIET_START = '21:00'
const DEFAULT_QUIET_END = '06:00'

function prefsUrl(): string {
  return `${API_BASE_URL}/api/v1/me/notification-preferences`
}

function normalizePrefs(raw: Partial<NotificationPrefs> | undefined): NotificationPrefs {
  const channels = (raw?.channels ?? {}) as Partial<NotificationPrefs['channels']>
  const templates = raw?.templates ?? {}
  return {
    channels: {
      email: Boolean(channels.email),
      sms: Boolean(channels.sms),
      push: Boolean(channels.push),
      whatsapp: Boolean(channels.whatsapp)
    },
    templates: { ...templates },
    quietHoursStart: raw?.quietHoursStart ?? null,
    quietHoursEnd: raw?.quietHoursEnd ?? null,
    lastSavedAt: raw?.lastSavedAt ?? raw?.updatedAt ?? null,
    updatedAt: raw?.updatedAt ?? null
  }
}

function templateKey(categoryId: string, channel: Channel): string {
  return `${categoryId}:${channel}`
}

function isCategoryChannelOn(prefs: NotificationPrefs, categoryId: string, channel: Channel): boolean {
  const key = templateKey(categoryId, channel)
  if (Object.prototype.hasOwnProperty.call(prefs.templates, key)) {
    return Boolean(prefs.templates[key])
  }
  return prefs.channels[channel]
}

function setCategoryChannel(
  prefs: NotificationPrefs,
  categoryId: string,
  channel: Channel,
  value: boolean
): NotificationPrefs {
  return {
    ...prefs,
    templates: {
      ...prefs.templates,
      [templateKey(categoryId, channel)]: value
    }
  }
}

function activeChannelCount(prefs: NotificationPrefs): number {
  let count = 0
  for (const category of CATEGORIES) {
    for (const channel of CHANNEL_ORDER) {
      if (isCategoryChannelOn(prefs, category.id, channel)) {
        count += 1
      }
    }
  }
  return count
}

function usePreferences(): UseQueryResult<NotificationPrefs, Error> {
  return useQuery<NotificationPrefs, Error>({
    queryKey: ['me', 'notification-preferences'],
    queryFn: async ({ signal }) => {
      const response = await request<PreferencesResponse>(prefsUrl(), {
        method: 'GET',
        signal
      })
      return normalizePrefs(response?.data)
    },
    staleTime: 60_000
  })
}

interface SavePayload {
  readonly channels: NotificationPrefs['channels']
  readonly templates: NotificationPrefs['templates']
  readonly quietHoursStart?: string
  readonly quietHoursEnd?: string
}

function useSavePreferences(): UseMutationResult<NotificationPrefs, Error, SavePayload> {
  const queryClient = useQueryClient()
  return useMutation<NotificationPrefs, Error, SavePayload>({
    mutationFn: async (payload) => {
      const response = await request<PreferencesResponse>(prefsUrl(), {
        method: 'PUT',
        body: payload
      })
      return normalizePrefs(response?.data)
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: ['me', 'notification-preferences'] })
      const previous = queryClient.getQueryData<NotificationPrefs>([
        'me',
        'notification-preferences'
      ])
      if (previous) {
        queryClient.setQueryData<NotificationPrefs>(
          ['me', 'notification-preferences'],
          {
            ...previous,
            channels: payload.channels,
            templates: payload.templates,
            quietHoursStart: payload.quietHoursStart ?? previous.quietHoursStart,
            quietHoursEnd: payload.quietHoursEnd ?? previous.quietHoursEnd
          }
        )
      }
      return { previous } as unknown as NotificationPrefs
    },
    onError: (_err, _payload, ctx) => {
      const previous = (ctx as unknown as { previous?: NotificationPrefs } | undefined)?.previous
      if (previous) {
        queryClient.setQueryData(['me', 'notification-preferences'], previous)
      }
    },
    onSuccess: (next) => {
      queryClient.setQueryData(['me', 'notification-preferences'], next)
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me', 'notification-preferences'] })
    }
  })
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <NotificationsCenter />
      </ScreenShell>
    </RoleGuard>
  )
}

function NotificationsCenter(): JSX.Element {
  const query = usePreferences()
  const saveMutation = useSavePreferences()
  const [localPrefs, setLocalPrefs] = useState<NotificationPrefs | null>(null)
  const [quietHoursEnabled, setQuietHoursEnabled] = useState<boolean | null>(null)

  const prefs = localPrefs ?? query.data ?? null

  const quietOn = useMemo<boolean>(() => {
    if (quietHoursEnabled !== null) return quietHoursEnabled
    if (!prefs) return true
    return prefs.quietHoursStart !== null && prefs.quietHoursEnd !== null
  }, [quietHoursEnabled, prefs])

  const channelCount = useMemo<number>(
    () => (prefs ? activeChannelCount(prefs) : 0),
    [prefs]
  )

  const toggle = useCallback(
    (categoryId: string, channel: Channel): void => {
      if (!prefs) return
      const current = isCategoryChannelOn(prefs, categoryId, channel)
      const next = setCategoryChannel(prefs, categoryId, channel, !current)
      setLocalPrefs(next)
    },
    [prefs]
  )

  const save = useCallback((): void => {
    if (!prefs) return
    const base: SavePayload = {
      channels: prefs.channels,
      templates: prefs.templates
    }
    const payload: SavePayload = quietOn
      ? {
          ...base,
          quietHoursStart: prefs.quietHoursStart ?? DEFAULT_QUIET_START,
          quietHoursEnd: prefs.quietHoursEnd ?? DEFAULT_QUIET_END
        }
      : base
    saveMutation.mutate(payload, {
      onSuccess: (next) => {
        setLocalPrefs(next)
        setQuietHoursEnabled(null)
      }
    })
  }, [prefs, quietOn, saveMutation])

  if (query.isLoading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={colors.gold} />
        <Text style={styles.loadingText}>{COPY.loading}</Text>
      </View>
    )
  }

  if (query.isError) {
    const status = query.error instanceof ApiError ? query.error.status : -1
    const kind = status === 0 ? 'offline' : 'env-missing'
    return (
      <View>
        <PreviewBanner kind={kind} />
      </View>
    )
  }

  if (!prefs) {
    return (
      <View>
        <PreviewBanner kind="no-data" />
      </View>
    )
  }

  const quietStart = prefs.quietHoursStart ?? DEFAULT_QUIET_START
  const quietEnd = prefs.quietHoursEnd ?? DEFAULT_QUIET_END
  const savedAt = prefs.lastSavedAt ?? prefs.updatedAt ?? null

  return (
    <View>
      <Section title={COPY.summaryTitle} hint={COPY.summaryHint(channelCount)}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>{COPY.quietHoursLabel(quietStart, quietEnd)}</Text>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: quietOn }}
            onPress={() => setQuietHoursEnabled((value) => (value === null ? !quietOn : !value))}
            style={[styles.toggle, quietOn ? styles.toggleOn : styles.toggleOff]}
          >
            <Text style={[styles.toggleLabel, quietOn ? styles.toggleLabelOn : null]}>
              {quietOn ? COPY.quietHoursOn : COPY.quietHoursOff}
            </Text>
          </Pressable>
        </View>
      </Section>

      <Section title={COPY.categories} hint={COPY.categoriesHint}>
        {CATEGORIES.map((category) => (
          <View key={category.id} style={styles.categoryRow}>
            <View style={styles.categoryHead}>
              <Text style={styles.categoryLabel}>{category.label}</Text>
              <Text style={styles.categoryHint}>{category.hint}</Text>
            </View>
            <View style={styles.channelRow}>
              {CHANNEL_ORDER.map((channel) => {
                const enabled = isCategoryChannelOn(prefs, category.id, channel)
                return (
                  <Pressable
                    key={channel}
                    accessibilityRole="button"
                    accessibilityLabel={`${category.label} ${CHANNEL_LABELS[channel]}`}
                    accessibilityState={{ selected: enabled }}
                    onPress={() => toggle(category.id, channel)}
                    style={({ pressed }) => [
                      styles.chip,
                      enabled ? styles.chipOn : styles.chipOff,
                      pressed ? styles.chipPressed : null
                    ]}
                  >
                    <Text style={[styles.chipText, enabled ? styles.chipTextOn : null]}>
                      {CHANNEL_LABELS[channel]}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          </View>
        ))}
      </Section>

      <Section title={COPY.saveSection}>
        <Button label={COPY.save} onPress={save} loading={saveMutation.isPending} />
        {savedAt ? (
          <Text style={styles.savedNote}>{COPY.savedNote(formatTime(savedAt))}</Text>
        ) : (
          <Text style={styles.savedNote}>{COPY.pending}</Text>
        )}
      </Section>
    </View>
  )
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

const styles = StyleSheet.create({
  loadingWrap: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  loadingText: { color: colors.textMuted, fontSize: fontSize.body },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceAlt,
    padding: spacing.md,
    borderRadius: radius.md
  },
  summaryLabel: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '600',
    flex: 1
  },
  toggle: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1
  },
  toggleOn: {
    backgroundColor: colors.gold,
    borderColor: colors.goldDark
  },
  toggleOff: {
    backgroundColor: colors.surface,
    borderColor: colors.border
  },
  toggleLabel: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontWeight: '700'
  },
  toggleLabelOn: {
    color: colors.earth900
  },
  categoryRow: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  categoryHead: {
    marginBottom: spacing.sm
  },
  categoryLabel: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  categoryHint: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  },
  channelRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    minWidth: 64,
    alignItems: 'center'
  },
  chipOn: {
    backgroundColor: colors.gold,
    borderColor: colors.goldDark
  },
  chipOff: {
    backgroundColor: colors.surface,
    borderColor: colors.border
  },
  chipPressed: {
    opacity: 0.7
  },
  chipText: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontWeight: '700'
  },
  chipTextOn: {
    color: colors.earth900
  },
  savedNote: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.sm
  }
})
