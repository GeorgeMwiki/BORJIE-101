import { StyleSheet, Text, TextInput, View } from 'react-native'
import type { KeyboardTypeOptions } from 'react-native'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'

export interface FieldProps {
  label: string
  value: string
  onChangeText: (next: string) => void
  placeholder?: string
  error?: string | null
  keyboardType?: KeyboardTypeOptions
  multiline?: boolean
  autoCapitalize?: 'characters' | 'words' | 'sentences' | 'none'
  testID?: string
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  keyboardType,
  multiline,
  autoCapitalize,
  testID
}: FieldProps): JSX.Element {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        testID={testID}
        style={[styles.input, multiline ? styles.multiline : null, error ? styles.inputError : null]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
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
    color: colors.text,
    fontSize: fontSize.lead,
    minHeight: 48
  },
  multiline: {
    minHeight: 96,
    textAlignVertical: 'top'
  },
  inputError: {
    borderColor: colors.danger
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  }
})
