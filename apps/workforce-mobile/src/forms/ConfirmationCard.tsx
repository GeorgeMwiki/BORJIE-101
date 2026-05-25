import { StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'

export interface ConfirmationCardProps {
  title: string
  message: string
  refLabel: string
  refValue: string
  pendingSyncLabel?: string
  online: boolean
}

/**
 * Optimistic confirmation shown after a successful enqueue. Tells the user
 * the write is captured (with the queue id) and whether sync is pending.
 */
export function ConfirmationCard({
  title,
  message,
  refLabel,
  refValue,
  pendingSyncLabel,
  online
}: ConfirmationCardProps): JSX.Element {
  return (
    <View style={[styles.card, online ? styles.cardOnline : styles.cardOffline]}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      <View style={styles.refRow}>
        <Text style={styles.refLabel}>{refLabel}</Text>
        <Text style={styles.refValue}>{refValue}</Text>
      </View>
      {!online && pendingSyncLabel ? (
        <Text style={styles.syncHint}>{pendingSyncLabel}</Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1
  },
  cardOnline: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.success
  },
  cardOffline: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.warn
  },
  title: {
    color: colors.earth900,
    fontSize: fontSize.h3,
    fontWeight: '700'
  },
  message: {
    color: colors.text,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  refRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  refLabel: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontWeight: '600'
  },
  refValue: {
    color: colors.earth900,
    fontSize: fontSize.caption,
    fontWeight: '700'
  },
  syncHint: {
    marginTop: spacing.sm,
    color: colors.warn,
    fontSize: fontSize.body,
    fontStyle: 'italic'
  }
})
