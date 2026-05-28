import { ReactNode } from 'react'
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native'
import { tokens } from '@/ui-litfin'

export interface FormFieldProps extends Omit<TextInputProps, 'style'> {
  readonly label: string
  readonly error?: string
  readonly trailing?: ReactNode
}

/**
 * LitFin form field — eyebrow label + dark-glass input pill on navy
 * with cream text. Error state goes warm-red border + 1-line caption.
 */
export function FormField({ label, error, trailing, ...inputProps }: FormFieldProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.row, error ? styles.rowError : undefined]}>
        <TextInput
          {...inputProps}
          placeholderTextColor={tokens.color.textMuted}
          style={styles.input}
        />
        {trailing}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginBottom: tokens.space.md },
  label: {
    ...tokens.type.eyebrow,
    color: tokens.color.gold,
    marginBottom: tokens.space.xs
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: tokens.color.borderStrong,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.color.bgRaised
  },
  rowError: { borderColor: tokens.color.danger },
  input: {
    flex: 1,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.md,
    color: tokens.color.textPrimary,
    fontSize: 16
  },
  errorText: {
    ...tokens.type.micro,
    color: tokens.color.danger,
    marginTop: tokens.space.xs
  }
})
