import { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'

export interface DropdownOption<T extends string> {
  value: T
  label: string
}

export interface DropdownProps<T extends string> {
  label: string
  value: T | null
  onChange: (value: T) => void
  options: ReadonlyArray<DropdownOption<T>>
  placeholder?: string
  error?: string | null
}

/**
 * Lightweight bottom-sheet dropdown. No third-party menu library; pure React
 * Native Modal. Keeps the bundle small for the field user.
 */
export function Dropdown<T extends string>({
  label,
  value,
  onChange,
  options,
  placeholder,
  error
}: DropdownProps<T>): JSX.Element {
  const [open, setOpen] = useState<boolean>(false)
  const selected = options.find((option) => option.value === value)
  const display = selected ? selected.label : placeholder ?? '—'

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setOpen(true)}
        style={[styles.input, error ? styles.inputError : null]}
      >
        <Text style={[styles.display, !selected ? styles.placeholder : null]}>{display}</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Modal animationType="fade" visible={open} transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{label}</Text>
            {options.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: option.value === value }}
                onPress={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
              >
                <Text
                  style={[
                    styles.rowLabel,
                    option.value === value ? styles.rowLabelSelected : null
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.md
  },
  label: {
    color: colors.earth900,
    fontSize: fontSize.body,
    fontWeight: '600',
    marginBottom: spacing.xs
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 48,
    justifyContent: 'center'
  },
  inputError: {
    borderColor: colors.danger
  },
  display: {
    color: colors.text,
    fontSize: fontSize.lead
  },
  placeholder: {
    color: colors.textMuted
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(31, 20, 16, 0.55)',
    justifyContent: 'flex-end'
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg
  },
  sheetTitle: {
    color: colors.earth900,
    fontSize: fontSize.h3,
    fontWeight: '700',
    marginBottom: spacing.md
  },
  row: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  rowPressed: {
    backgroundColor: colors.surfaceAlt
  },
  rowLabel: {
    color: colors.text,
    fontSize: fontSize.lead
  },
  rowLabelSelected: {
    color: colors.goldDark,
    fontWeight: '700'
  }
})
