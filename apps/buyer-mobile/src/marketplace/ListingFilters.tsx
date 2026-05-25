import { useMemo } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { ChipGroup } from '@/components/ChipGroup'
import { buildMineralOptions, buildRegionOptions, sortOptions } from './options'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'
import type { ListingFilters, SortKey } from '@/api/marketplace'
import type { Mineral } from '@/types/listing'

export interface ListingFiltersBarProps {
  readonly filters: ListingFilters
  readonly onChange: (next: ListingFilters) => void
  readonly translate: (key: string) => string
}

export function ListingFiltersBar({ filters, onChange, translate }: ListingFiltersBarProps) {
  const mineralOptions = useMemo(() => buildMineralOptions(translate), [translate])
  const regionOptions = useMemo(() => buildRegionOptions(), [])
  const sortChips = useMemo(
    () => sortOptions.map((opt) => ({ value: opt.value, label: translate(opt.key) })),
    [translate]
  )

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{translate('marketplace.mineral_filter')}</Text>
      <ChipGroup<Mineral>
        options={mineralOptions}
        value={filters.mineral ?? null}
        onChange={(next) => onChange({ ...filters, mineral: next ?? undefined })}
      />

      <Text style={styles.label}>{translate('marketplace.region_filter')}</Text>
      <ChipGroup<string>
        options={regionOptions}
        value={filters.region ?? null}
        onChange={(next) => onChange({ ...filters, region: next ?? undefined })}
      />

      <Text style={styles.label}>{translate('marketplace.grade_filter')}</Text>
      <View style={styles.gradeRow}>
        <TextInput
          value={filters.minGradeNumeric === undefined ? '' : String(filters.minGradeNumeric)}
          onChangeText={(text) => onChange({ ...filters, minGradeNumeric: parseGrade(text) })}
          placeholder={translate('marketplace.min_grade')}
          placeholderTextColor={colors.inkMuted}
          keyboardType="numeric"
          style={styles.input}
        />
        <TextInput
          value={filters.maxGradeNumeric === undefined ? '' : String(filters.maxGradeNumeric)}
          onChangeText={(text) => onChange({ ...filters, maxGradeNumeric: parseGrade(text) })}
          placeholder={translate('marketplace.max_grade')}
          placeholderTextColor={colors.inkMuted}
          keyboardType="numeric"
          style={styles.input}
        />
      </View>

      <Text style={styles.label}>{translate('marketplace.sort')}</Text>
      <ChipGroup<SortKey>
        options={sortChips}
        value={filters.sort ?? 'newest'}
        onChange={(next) => onChange({ ...filters, sort: next ?? 'newest' })}
        allowClear={false}
      />
    </View>
  )
}

function parseGrade(text: string): number | undefined {
  if (!text) {
    return undefined
  }
  const value = Number(text.replace(',', '.'))
  return Number.isFinite(value) ? value : undefined
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: { ...typography.micro, color: colors.inkMuted, textTransform: 'uppercase', marginTop: spacing.sm },
  gradeRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
    color: colors.ink,
    ...typography.body
  }
})
