import { StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'

export type PreviewBannerKind = 'env-missing' | 'no-data' | 'offline'

export interface PreviewBannerProps {
  readonly kind: PreviewBannerKind
}

/**
 * Honest-UX banner surfacing real failure modes (no fake-data affordance).
 * Three kinds: backend unconfigured, empty endpoint, device offline.
 *
 * Copy is inlined as a frozen const map — i18n files are owned by other
 * agents this wave. Swahili-first per CLAUDE.md, English as secondary line.
 */
export const BANNER_COPY = Object.freeze({
  'env-missing': Object.freeze({
    sw: 'Borjie haijaunganishwa na seva. Wasiliana na msimamizi.',
    en: 'Borjie is not connected to the backend.'
  }),
  'no-data': Object.freeze({
    sw: 'Hakuna data bado kwa akaunti yako.',
    en: 'No data yet on your account.'
  }),
  offline: Object.freeze({
    sw: 'Uko nje ya mtandao. Tutasync ukirudi.',
    en: "You are offline. We'll sync when you reconnect."
  })
}) as Readonly<Record<PreviewBannerKind, Readonly<{ sw: string; en: string }>>>

export function PreviewBanner({ kind }: PreviewBannerProps): JSX.Element {
  const copy = BANNER_COPY[kind]
  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel={`${copy.sw} — ${copy.en}`}
      testID={`preview-banner-${kind}`}
      style={[styles.wrap, kindStyle(kind)]}
    >
      <Text style={styles.label}>{copy.sw}</Text>
      <Text style={styles.sub}>{copy.en}</Text>
    </View>
  )
}

function kindStyle(kind: PreviewBannerKind): { backgroundColor: string; borderColor: string } {
  if (kind === 'offline') {
    return { backgroundColor: colors.earth700, borderColor: colors.danger }
  }
  if (kind === 'no-data') {
    return { backgroundColor: colors.earth700, borderColor: 'rgba(255, 255, 255, 0.18)' }
  }
  return { backgroundColor: colors.earth700, borderColor: colors.gold }
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderLeftWidth: 3,
    borderWidth: 1,
    marginBottom: spacing.md
  },
  label: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '700'
  },
  sub: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  }
})
