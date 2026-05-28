import { StyleSheet, Text, View } from 'react-native'
import { colors } from '../../theme/colors'
import { fontSize, radius, spacing } from '../../theme/spacing'
import { classifyDelta, formatDelta, formatTonnes } from './format'
import type { ProductionPillar } from './types'

export interface ProductionVsTargetProps {
  readonly production: ProductionPillar
  readonly lang: 'sw' | 'en'
}

/**
 * Slot 4 — Production pillar. Per-site list with delta vs target. Spec
 * §C drill-down ladder caps at 3 levels: this is Level-2 inline (summary
 * → segment list). Site rows are tappable in a later wave; here they
 * remain accessible read-only summaries with explicit status text.
 */
export function ProductionVsTarget({ production, lang }: ProductionVsTargetProps): JSX.Element {
  const sites = production.perSite
  return (
    <View testID="owner-home-production" style={styles.wrap}>
      <Text style={styles.header}>
        {lang === 'sw' ? 'Uzalishaji kwa mgodi' : 'Production by site'}
      </Text>
      {sites.length === 0 ? (
        <Text style={styles.empty}>
          {lang === 'sw' ? 'Hakuna shifti zilizoripotiwa.' : 'No shifts reported yet.'}
        </Text>
      ) : (
        sites.map((site) => {
          const delta = site.target > 0 ? ((site.tonnes - site.target) / site.target) * 100 : 0
          const status = classifyDelta(delta)
          return (
            <View
              key={site.siteId}
              accessibilityRole="summary"
              accessibilityLabel={`${site.siteName} · ${formatTonnes(site.tonnes)} · ${formatDelta(delta)}`}
              style={styles.row}
            >
              <View style={styles.rowMain}>
                <Text style={styles.siteName}>{site.siteName}</Text>
                <Text style={styles.tonnes}>{formatTonnes(site.tonnes)}</Text>
              </View>
              <View style={styles.rowMeta}>
                <Text style={[styles.delta, deltaTone(status)]}>{formatDelta(delta)}</Text>
                <Text style={styles.target}>
                  {lang === 'sw' ? 'Lengo' : 'Target'}: {formatTonnes(site.target)}
                </Text>
              </View>
            </View>
          )
        })
      )}
    </View>
  )
}

function deltaTone(status: ReturnType<typeof classifyDelta>): { color: string } {
  if (status === 'danger') {
    return { color: colors.danger }
  }
  if (status === 'warn') {
    return { color: colors.warn }
  }
  return { color: colors.success }
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.lg
  },
  header: {
    color: colors.text,
    fontSize: fontSize.h3,
    fontWeight: '700',
    marginBottom: spacing.sm
  },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    fontStyle: 'italic'
  },
  row: {
    backgroundColor: colors.earth700,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    minHeight: 48
  },
  rowMain: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  siteName: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  tonnes: {
    color: colors.gold,
    fontSize: fontSize.h3,
    fontWeight: '800'
  },
  rowMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs
  },
  delta: {
    fontSize: fontSize.body,
    fontWeight: '700'
  },
  target: {
    color: colors.textMuted,
    fontSize: fontSize.caption
  }
})
