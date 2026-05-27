import { StyleSheet, Text, View } from 'react-native'
import { colors } from '../../theme/colors'
import { fontSize, radius, spacing } from '../../theme/spacing'
import { formatCurrency, formatDelta, formatTonnes } from './format'
import type { OwnerBrief, PillarStatus } from './types'

export interface KpiStripProps {
  readonly brief: OwnerBrief
  readonly lang: 'sw' | 'en'
  readonly currencyCode?: string
}

/**
 * Slot 3 — Pillar KPI strip. Five glanceable cards: production, cash
 * runway, safety, licence health, FX exposure. KPI font ≥24pt (uses
 * theme `fontSize.h1` 28pt) per spec engineering rule. Status colours
 * paired with textual status labels (anti-pattern §3: never colour-only).
 */
export function KpiStrip({ brief, lang, currencyCode = 'TZS' }: KpiStripProps): JSX.Element {
  const items = buildItems(brief, lang, currencyCode)
  return (
    <View testID="owner-home-kpi-strip" style={styles.wrap}>
      {items.map((item) => (
        <View
          key={item.key}
          accessibilityRole="summary"
          accessibilityLabel={`${item.label} · ${item.value} · ${item.statusLabel}`}
          style={[styles.card, statusAccent(item.status)]}
        >
          <Text style={styles.label}>{item.label}</Text>
          <Text style={styles.value}>{item.value}</Text>
          <Text style={styles.status}>{item.statusLabel}</Text>
        </View>
      ))}
    </View>
  )
}

interface KpiItem {
  readonly key: string
  readonly label: string
  readonly value: string
  readonly status: PillarStatus
  readonly statusLabel: string
}

function buildItems(
  brief: OwnerBrief,
  lang: 'sw' | 'en',
  currencyCode: string
): ReadonlyArray<KpiItem> {
  const swLabels = {
    production: 'Uzalishaji',
    cash: 'Pesa',
    safety: 'Usalama',
    licence: 'Leseni',
    fx: 'USD-cliff'
  }
  const enLabels = {
    production: 'Production',
    cash: 'Cash',
    safety: 'Safety',
    licence: 'Licences',
    fx: 'USD-cliff'
  }
  const labels = lang === 'sw' ? swLabels : enLabels
  return [
    {
      key: 'production',
      label: labels.production,
      value: `${formatTonnes(brief.production.currentTonnes)} ${formatDelta(brief.production.deltaPct)}`,
      status: brief.production.status,
      statusLabel: statusLabel(brief.production.status, lang)
    },
    {
      key: 'cash',
      label: labels.cash,
      value: `${brief.cash.daysRemaining} ${lang === 'sw' ? 'siku' : 'days'}`,
      status: brief.cash.status,
      statusLabel: formatCurrency(brief.cash.currentTzs, currencyCode)
    },
    {
      key: 'safety',
      label: labels.safety,
      value: `${brief.safety.openHighCount}`,
      status: brief.safety.openHighCount > 0 ? 'danger' : 'ok',
      statusLabel: lang === 'sw' ? 'Wazi (HIGH)' : 'Open (HIGH)'
    },
    {
      key: 'licence',
      label: labels.licence,
      value: lang === 'sw' ? brief.safety.licenceLabelSw : brief.safety.licenceLabelEn,
      status: brief.safety.licencesStatus,
      statusLabel: statusLabel(brief.safety.licencesStatus, lang)
    },
    {
      key: 'fx',
      label: labels.fx,
      value: brief.cash.usdCliffActive
        ? (lang === 'sw' ? 'Hai' : 'Active')
        : (lang === 'sw' ? 'Salama' : 'Cleared'),
      status: brief.cash.usdCliffActive ? 'danger' : 'ok',
      statusLabel: formatCurrency(brief.cash.usdExposureTzs, currencyCode)
    }
  ]
}

function statusLabel(status: PillarStatus, lang: 'sw' | 'en'): string {
  if (status === 'ok') {
    return lang === 'sw' ? 'Salama' : 'On target'
  }
  if (status === 'warn') {
    return lang === 'sw' ? 'Tahadhari' : 'Watch'
  }
  return lang === 'sw' ? 'Hatari' : 'At risk'
}

function statusAccent(status: PillarStatus): { borderColor: string } {
  if (status === 'danger') {
    return { borderColor: colors.danger }
  }
  if (status === 'warn') {
    return { borderColor: colors.warn }
  }
  return { borderColor: colors.success }
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg
  },
  card: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 96
  },
  label: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase'
  },
  value: {
    color: colors.earth900,
    fontSize: fontSize.h1,
    fontWeight: '800',
    marginTop: spacing.xs
  },
  status: {
    color: colors.text,
    fontSize: fontSize.caption,
    fontWeight: '600',
    marginTop: spacing.xs
  }
})
