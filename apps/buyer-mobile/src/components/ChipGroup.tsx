import { Pressable, ScrollView, StyleSheet, Text } from 'react-native'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'

export interface ChipOption<T extends string> {
  readonly value: T
  readonly label: string
}

export interface ChipGroupProps<T extends string> {
  readonly options: readonly ChipOption<T>[]
  readonly value: T | null
  readonly onChange: (value: T | null) => void
  readonly allowClear?: boolean
}

export function ChipGroup<T extends string>({ options, value, onChange, allowClear = true }: ChipGroupProps<T>) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {options.map((option) => {
        const selected = value === option.value
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(selected && allowClear ? null : option.value)}
            style={[styles.chip, selected ? styles.chipActive : undefined]}
          >
            <Text style={[styles.label, selected ? styles.labelActive : undefined]}>{option.label}</Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  row: { paddingVertical: spacing.xs, gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    marginRight: spacing.sm
  },
  chipActive: { backgroundColor: colors.forest, borderColor: colors.forest },
  label: { ...typography.caption, color: colors.inkSoft },
  labelActive: { color: colors.bone, fontWeight: '600' }
})
