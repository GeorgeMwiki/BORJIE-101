import { ReactNode } from 'react'
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'

export interface FormFieldProps extends Omit<TextInputProps, 'style'> {
  readonly label: string
  readonly error?: string
  readonly trailing?: ReactNode
}

export function FormField({ label, error, trailing, ...inputProps }: FormFieldProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.row, error ? styles.rowError : undefined]}>
        <TextInput
          {...inputProps}
          placeholderTextColor={colors.inkMuted}
          style={styles.input}
        />
        {trailing}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: { ...typography.caption, color: colors.inkMuted, marginBottom: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.white
  },
  rowError: { borderColor: colors.danger },
  input: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.ink,
    ...typography.body
  },
  errorText: { ...typography.micro, color: colors.danger, marginTop: spacing.xs }
})
