/**
 * MineMatcherPanel — buyer-side mine recommender surface.
 *
 * Drives `@borjie/buyer-marketplace-advisor` (via the gateway) to rank
 * live mineral-supply listings against a buyer's need. The buyer picks
 * a commodity + required tonnage (and an optional grade floor / price
 * ceiling); the panel renders the ranked mines with their fit score,
 * the advisor's evidence-bearing rationale, the indicative USD/tonne
 * price, available tonnage, and estimated lead time.
 *
 * The ranking is REAL compute server-side over REAL Postgres rows — a
 * tenant with no matching listings sees an honest empty state, never a
 * fabricated mine.
 *
 * Bilingual: every label resolves through `useTranslation().t` so the
 * panel is single-language per the buyer's active locale (no EN/SW
 * mixing). Money is rendered with a locale-aware Intl formatter keyed on
 * the currency code the advisor uses (USD) — never hard-coded glyphs.
 */

import { useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useMutation } from '@tanstack/react-query'
import { Card } from '@/components/Card'
import { Pill } from '@/components/Pill'
import { PrimaryButton } from '@/components/PrimaryButton'
import { tokens } from '@/ui-litfin'
import { useTranslation } from '@/hooks/useTranslation'
import { bcp47For } from '@/lib/locale'
import type { LanguageCode } from '@/types/auth'
import {
  recommendMines,
  type AdvisorCommodity,
  type MineRecommendation,
} from '@/api/marketplace-advisor'

// Commodities the matcher offers. Kept in sync with the advisor enum.
const COMMODITIES: readonly AdvisorCommodity[] = [
  'gold',
  'copper',
  'silver',
  'tin',
  'tanzanite',
  'graphite',
  'coal',
  'iron-ore',
  'nickel',
  'cobalt',
]

// Default FX used to project seller TZS prices onto the advisor's USD
// axis when the caller has no live rate. Surfaced as an editable field
// so a buyer can override with today's rate; never silently hard-coded
// into business logic — it is a request input, echoed in the UI.
const DEFAULT_FX_TZS_PER_USD = 2600

function formatUsdPerTonne(value: number, lang: LanguageCode): string {
  try {
    return `${new Intl.NumberFormat(bcp47For(lang), {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value)}/t`
  } catch {
    return `USD ${Math.round(value)}/t`
  }
}

function fitTone(score: number): 'success' | 'gold' | 'warning' {
  if (score >= 70) return 'success'
  if (score >= 45) return 'gold'
  return 'warning'
}

export interface MineMatcherPanelProps {
  /** Optional pre-selected commodity (e.g. from the listing the buyer
   *  was viewing). Defaults to gold. */
  readonly initialCommodity?: AdvisorCommodity
  /** Optional live FX rate (TZS per USD). Falls back to the editable
   *  default when absent. */
  readonly fxTzsPerUsd?: number
}

export function MineMatcherPanel({
  initialCommodity = 'gold',
  fxTzsPerUsd,
}: MineMatcherPanelProps) {
  const { t, lang } = useTranslation()
  const [commodity, setCommodity] = useState<AdvisorCommodity>(initialCommodity)
  const [volumeText, setVolumeText] = useState('100')
  const [minGradeText, setMinGradeText] = useState('')
  const [fxText, setFxText] = useState(
    String(fxTzsPerUsd ?? DEFAULT_FX_TZS_PER_USD),
  )

  const mutation = useMutation({
    mutationFn: (signal?: AbortSignal) => {
      const volumeTonnes = Number(volumeText)
      const minGrade = minGradeText.trim() === '' ? undefined : Number(minGradeText)
      const fx = Number(fxText)
      return recommendMines(
        {
          commodity,
          volumeTonnes:
            Number.isFinite(volumeTonnes) && volumeTonnes > 0 ? volumeTonnes : 1,
          ...(minGrade !== undefined && Number.isFinite(minGrade)
            ? { minGrade }
            : {}),
          fxTzsPerUsd:
            Number.isFinite(fx) && fx > 0 ? fx : DEFAULT_FX_TZS_PER_USD,
        },
        signal,
      )
    },
  })

  const results: readonly MineRecommendation[] = useMemo(
    () => mutation.data ?? [],
    [mutation.data],
  )

  const volumeValid = Number(volumeText) > 0

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      testID="mine-matcher-panel"
    >
      <Text style={styles.eyebrow}>{t('mineMatcher.eyebrow')}</Text>
      <Text style={styles.title}>{t('mineMatcher.title')}</Text>
      <Text style={styles.subtitle}>{t('mineMatcher.subtitle')}</Text>

      {/* ── Need form ── */}
      <Card>
        <Text style={styles.fieldLabel}>{t('mineMatcher.commodity')}</Text>
        <View style={styles.chipRow}>
          {COMMODITIES.map((c) => {
            const selected = c === commodity
            return (
              <Text
                key={c}
                onPress={() => setCommodity(c)}
                style={[styles.commodityChip, selected && styles.commodityChipOn]}
                testID={`commodity-${c}`}
              >
                {t(`commodity.${c}`)}
              </Text>
            )
          })}
        </View>

        <View style={styles.inputRow}>
          <View style={styles.inputCol}>
            <Text style={styles.fieldLabel}>{t('mineMatcher.volumeTonnes')}</Text>
            <TextInput
              value={volumeText}
              onChangeText={setVolumeText}
              keyboardType="numeric"
              style={styles.input}
              placeholder="100"
              placeholderTextColor={tokens.color.textMuted}
              testID="volume-input"
            />
          </View>
          <View style={styles.inputCol}>
            <Text style={styles.fieldLabel}>{t('mineMatcher.minGrade')}</Text>
            <TextInput
              value={minGradeText}
              onChangeText={setMinGradeText}
              keyboardType="numeric"
              style={styles.input}
              placeholder={t('mineMatcher.optional')}
              placeholderTextColor={tokens.color.textMuted}
              testID="grade-input"
            />
          </View>
        </View>

        <Text style={styles.fieldLabel}>{t('mineMatcher.fxRate')}</Text>
        <TextInput
          value={fxText}
          onChangeText={setFxText}
          keyboardType="numeric"
          style={styles.input}
          testID="fx-input"
        />

        <View style={styles.actionRow}>
          <PrimaryButton
            label={t('mineMatcher.findMines')}
            variant="gold"
            onPress={() => mutation.mutate(undefined)}
            disabled={!volumeValid || mutation.isPending}
            busy={mutation.isPending}
            testID="find-mines-button"
          />
        </View>
      </Card>

      {/* ── Error ── */}
      {mutation.isError ? (
        <Card>
          <Text style={styles.errorText}>{t('mineMatcher.error')}</Text>
        </Card>
      ) : null}

      {/* ── Empty (ran, no matches) ── */}
      {mutation.isSuccess && results.length === 0 ? (
        <Card>
          <Text style={styles.emptyTitle}>{t('mineMatcher.emptyTitle')}</Text>
          <Text style={styles.emptyBody}>{t('mineMatcher.emptyBody')}</Text>
        </Card>
      ) : null}

      {/* ── Results ── */}
      {results.map((rec) => (
        <Card key={rec.mineId}>
          <View style={styles.resultHeader}>
            <Text style={styles.resultName} numberOfLines={2}>
              {rec.mineName}
            </Text>
            <Pill
              label={`${Math.round(rec.fitScore)}`}
              tone={fitTone(rec.fitScore)}
            />
          </View>

          <Text style={styles.rationale}>{rec.rationale}</Text>

          <View style={styles.statRow}>
            <Stat
              label={t('mineMatcher.price')}
              value={formatUsdPerTonne(rec.indicativePriceUsdPerTonne, lang)}
            />
            <Stat
              label={t('mineMatcher.available')}
              value={`${Math.round(rec.availableTonnes)} t`}
            />
            <Stat
              label={t('mineMatcher.leadTime')}
              value={t('mineMatcher.days', { n: rec.estimatedLeadTimeDays })}
            />
          </View>

          {/* Factor breakdown — the advisor's evidence chain. */}
          <View style={styles.factorWrap}>
            {rec.factors.map((f) => (
              <View key={f.label} style={styles.factorRow}>
                <Text style={styles.factorLabel}>{t(`factor.${f.label}`)}</Text>
                <Text style={styles.factorValue}>
                  {Math.round(f.contribution)} / {Math.round(f.weight)}
                </Text>
              </View>
            ))}
          </View>
        </Card>
      ))}
    </ScrollView>
  )
}

function Stat({
  label,
  value,
}: {
  readonly label: string
  readonly value: string
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.color.bgBase },
  content: { padding: tokens.space.lg, paddingBottom: tokens.space.xxxl },
  eyebrow: { ...tokens.type.eyebrow, color: tokens.color.gold },
  title: {
    ...tokens.type.h2,
    color: tokens.color.textPrimary,
    marginTop: tokens.space.xs,
  },
  subtitle: {
    ...tokens.type.bodySm,
    color: tokens.color.textSecondary,
    marginTop: tokens.space.xs,
    marginBottom: tokens.space.lg,
  },
  fieldLabel: {
    ...tokens.type.bodySmStrong,
    color: tokens.color.textSecondary,
    marginBottom: tokens.space.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.space.sm,
    marginBottom: tokens.space.md,
  },
  commodityChip: {
    ...tokens.type.bodySmStrong,
    color: tokens.color.textSecondary,
    backgroundColor: tokens.color.bgMuted,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    borderColor: tokens.color.border,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    overflow: 'hidden',
  },
  commodityChipOn: {
    color: tokens.color.textInverse,
    backgroundColor: tokens.color.gold,
    borderColor: tokens.color.borderGold,
  },
  inputRow: { flexDirection: 'row', gap: tokens.space.md },
  inputCol: { flex: 1 },
  input: {
    ...tokens.type.body,
    color: tokens.color.textPrimary,
    backgroundColor: tokens.color.bgMuted,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.color.border,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.md,
    marginBottom: tokens.space.md,
  },
  actionRow: { marginTop: tokens.space.sm },
  errorText: { ...tokens.type.body, color: tokens.color.danger },
  emptyTitle: {
    ...tokens.type.section,
    color: tokens.color.textPrimary,
    marginBottom: tokens.space.xs,
  },
  emptyBody: { ...tokens.type.bodySm, color: tokens.color.textSecondary },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.space.md,
  },
  resultName: {
    ...tokens.type.section,
    color: tokens.color.textPrimary,
    flex: 1,
  },
  rationale: {
    ...tokens.type.bodySm,
    color: tokens.color.textSecondary,
    marginTop: tokens.space.sm,
  },
  statRow: {
    flexDirection: 'row',
    gap: tokens.space.lg,
    marginTop: tokens.space.md,
  },
  stat: { flex: 1 },
  statLabel: { ...tokens.type.micro, color: tokens.color.textMuted },
  statValue: {
    ...tokens.type.bodyStrong,
    color: tokens.color.textPrimary,
    marginTop: 2,
  },
  factorWrap: {
    marginTop: tokens.space.md,
    borderTopWidth: 1,
    borderTopColor: tokens.color.border,
    paddingTop: tokens.space.md,
    gap: tokens.space.xs,
  },
  factorRow: { flexDirection: 'row', justifyContent: 'space-between' },
  factorLabel: { ...tokens.type.bodySm, color: tokens.color.textSecondary },
  factorValue: { ...tokens.type.bodySmStrong, color: tokens.color.textPrimary },
})
