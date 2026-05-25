import { StyleSheet, Text, View } from 'react-native'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'

export interface MessageBubbleProps {
  readonly from: 'buyer' | 'seller'
  readonly body: string
  readonly authorLabel: string
}

export function MessageBubble({ from, body, authorLabel }: MessageBubbleProps) {
  const isBuyer = from === 'buyer'
  return (
    <View style={[styles.bubble, isBuyer ? styles.bubbleBuyer : styles.bubbleSeller]}>
      <Text style={styles.author}>{authorLabel}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  bubble: {
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    maxWidth: '85%'
  },
  bubbleBuyer: { backgroundColor: colors.cream, alignSelf: 'flex-end' },
  bubbleSeller: { backgroundColor: colors.bone, alignSelf: 'flex-start' },
  author: { ...typography.micro, color: colors.inkMuted, textTransform: 'uppercase', marginBottom: 2 },
  body: { ...typography.body, color: colors.ink }
})
