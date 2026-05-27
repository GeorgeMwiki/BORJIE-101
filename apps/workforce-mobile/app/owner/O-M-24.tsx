import { useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Button } from '../../src/forms/Button'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-24'

type Channel = 'push' | 'whatsapp' | 'sms' | 'email'

interface CategoryPrefs {
  readonly id: string
  readonly label: string
  readonly hint: string
  readonly channels: Readonly<Record<Channel, boolean>>
}

const CHANNEL_LABELS: Readonly<Record<Channel, string>> = {
  push: 'Push',
  whatsapp: 'WA',
  sms: 'SMS',
  email: 'Barua'
}

const CHANNEL_ORDER: ReadonlyArray<Channel> = ['push', 'whatsapp', 'sms', 'email']

const INITIAL_PREFS: ReadonlyArray<CategoryPrefs> = [
  {
    id: 'maamuzi',
    label: 'Maamuzi',
    hint: 'Maamuzi mapya ya AI yanahitaji idhini',
    channels: { push: true, whatsapp: true, sms: false, email: true }
  },
  {
    id: 'pricing',
    label: 'Pricing',
    hint: 'Mabadiliko ya bei ya dhahabu, shaba, tanzanite',
    channels: { push: true, whatsapp: false, sms: true, email: false }
  },
  {
    id: 'safety',
    label: 'Safety',
    hint: 'Matukio ya hatari migodini',
    channels: { push: true, whatsapp: true, sms: true, email: true }
  },
  {
    id: 'compliance',
    label: 'Compliance',
    hint: 'PML, hati za ushuru, ripoti za mdhibiti',
    channels: { push: false, whatsapp: false, sms: false, email: true }
  },
  {
    id: 'crew',
    label: 'Crew',
    hint: 'Ripoti za shifti, mahudhurio, malipo',
    channels: { push: true, whatsapp: true, sms: false, email: false }
  },
  {
    id: 'fx',
    label: 'FX',
    hint: 'TZS-USD-KES rates, USD-cliff alerts',
    channels: { push: false, whatsapp: false, sms: false, email: true }
  }
]

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
  const [prefs, setPrefs] = useState<ReadonlyArray<CategoryPrefs>>(INITIAL_PREFS)
  const [savedAtISO, setSavedAtISO] = useState<string | null>(null)
  const [quietHours, setQuietHours] = useState<boolean>(true)

  const toggle = useCallback((categoryId: string, channel: Channel): void => {
    setPrefs((current) =>
      current.map((row) =>
        row.id === categoryId
          ? { ...row, channels: { ...row.channels, [channel]: !row.channels[channel] } }
          : row
      )
    )
  }, [])

  const save = useCallback((): void => {
    setSavedAtISO(new Date().toISOString())
  }, [])

  const activeChannelCount = useMemo<number>(() => {
    return prefs.reduce<number>(
      (sum, row) => sum + CHANNEL_ORDER.filter((channel) => row.channels[channel]).length,
      0
    )
  }, [prefs])

  return (
    <View>
      <Section title="Muhtasari" hint={`Njia za arifa zilizowashwa: ${activeChannelCount}`}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Saa za utulivu (21:00 - 06:00)</Text>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: quietHours }}
            onPress={() => setQuietHours((value) => !value)}
            style={[styles.toggle, quietHours ? styles.toggleOn : styles.toggleOff]}
          >
            <Text style={[styles.toggleLabel, quietHours ? styles.toggleLabelOn : null]}>
              {quietHours ? 'Imewashwa' : 'Imezimwa'}
            </Text>
          </Pressable>
        </View>
      </Section>

      <Section title="Kategoria" hint="Bonyeza njia ili kuzima au kuwasha">
        {prefs.map((row) => (
          <View key={row.id} style={styles.categoryRow}>
            <View style={styles.categoryHead}>
              <Text style={styles.categoryLabel}>{row.label}</Text>
              <Text style={styles.categoryHint}>{row.hint}</Text>
            </View>
            <View style={styles.channelRow}>
              {CHANNEL_ORDER.map((channel) => {
                const enabled = row.channels[channel]
                return (
                  <Pressable
                    key={channel}
                    accessibilityRole="button"
                    accessibilityLabel={`${row.label} ${CHANNEL_LABELS[channel]}`}
                    accessibilityState={{ selected: enabled }}
                    onPress={() => toggle(row.id, channel)}
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

      <Section title="Hifadhi mabadiliko">
        <Button label="Hifadhi" onPress={save} />
        {savedAtISO ? (
          <Text style={styles.savedNote}>Imehifadhiwa · {formatTime(savedAtISO)}</Text>
        ) : (
          <Text style={styles.savedNote}>Bado hakuna mabadiliko yaliyohifadhiwa</Text>
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
