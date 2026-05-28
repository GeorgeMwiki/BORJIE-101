import { useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import type { KeyboardTypeOptions, TextInputProps } from 'react-native'
import { tokens } from './tokens'

export interface LitFinFieldProps {
  readonly label: string
  readonly value: string
  readonly onChangeText: (next: string) => void
  readonly placeholder?: string
  readonly error?: string | null
  readonly hint?: string
  readonly keyboardType?: KeyboardTypeOptions
  readonly secureTextEntry?: boolean
  readonly multiline?: boolean
  readonly autoCapitalize?: TextInputProps['autoCapitalize']
  readonly testID?: string
  readonly autoComplete?: TextInputProps['autoComplete']
  readonly returnKeyType?: TextInputProps['returnKeyType']
  readonly maxLength?: number
}

/**
 * LitFin input field — mirrors the web borrower portal's
 * `bg-slate-900/60 border-white/8 rounded-lg` input chrome. Focus
 * ring uses gold border + soft gold glow.
 */
export function LitFinField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  hint,
  keyboardType,
  secureTextEntry,
  multiline,
  autoCapitalize,
  testID,
  autoComplete,
  returnKeyType,
  maxLength
}: LitFinFieldProps): JSX.Element {
  const [focused, setFocused] = useState<boolean>(false)
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View
        style={[
          styles.inputWrap,
          focused ? styles.inputWrapFocused : null,
          error ? styles.inputWrapError : null
        ]}
      >
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          placeholderTextColor={tokens.color.textMuted}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry}
          multiline={multiline}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          returnKeyType={returnKeyType}
          maxLength={maxLength}
          testID={testID}
          style={[styles.input, multiline ? styles.multiline : null]}
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!error && hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: tokens.space.lg
  },
  label: {
    ...tokens.type.bodySmStrong,
    color: tokens.color.textPrimary,
    marginBottom: tokens.space.xs
  },
  inputWrap: {
    backgroundColor: tokens.color.bgRaised,
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.md
  },
  inputWrapFocused: {
    borderColor: tokens.color.gold,
    ...tokens.shadow.glow
  },
  inputWrapError: {
    borderColor: tokens.color.danger
  },
  input: {
    ...tokens.type.body,
    color: tokens.color.textPrimary,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.md,
    minHeight: 48
  },
  multiline: {
    minHeight: 96,
    textAlignVertical: 'top'
  },
  error: {
    ...tokens.type.micro,
    color: tokens.color.danger,
    marginTop: tokens.space.xs
  },
  hint: {
    ...tokens.type.micro,
    color: tokens.color.textMuted,
    marginTop: tokens.space.xs
  }
})
