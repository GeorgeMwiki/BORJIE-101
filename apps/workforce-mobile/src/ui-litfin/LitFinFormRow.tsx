import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { tokens } from './tokens'

export interface LitFinFormRowProps {
  readonly label: string
  readonly hint?: string
  readonly children: ReactNode
  readonly required?: boolean
}

/**
 * LitFin form row — `label + helper + control` cluster the borrower
 * portal uses on every settings, KYC, profile field group.
 */
export function LitFinFormRow({ label, hint, children, required }: LitFinFormRowProps): JSX.Element {
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.label}>{label}</Text>
        {required ? <Text style={styles.req}>*</Text> : null}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <View style={styles.control}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: tokens.space.lg
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.xs
  },
  label: {
    ...tokens.type.bodySmStrong,
    color: tokens.color.textPrimary
  },
  req: {
    color: tokens.color.gold,
    fontWeight: '700'
  },
  hint: {
    ...tokens.type.micro,
    color: tokens.color.textMuted,
    marginTop: tokens.space.xs
  },
  control: {
    marginTop: tokens.space.sm
  }
})
