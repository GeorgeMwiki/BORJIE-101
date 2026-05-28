import { StyleSheet, Text, View } from 'react-native'
import { tokens } from '@/ui-litfin'

export interface MessageBubbleProps {
  readonly from: 'buyer' | 'seller'
  readonly body: string
  readonly authorLabel: string
}

/**
 * Buyer-seller message bubble — LitFin DNA. Buyer (right-aligned)
 * uses the warm-gold fill on navy text; seller (left-aligned) uses
 * the navy AI bubble with a soft gold top accent.
 */
export function MessageBubble({ from, body, authorLabel }: MessageBubbleProps) {
  const isBuyer = from === 'buyer'
  return (
    <View style={[styles.bubble, isBuyer ? styles.bubbleBuyer : styles.bubbleSeller]}>
      <Text style={[styles.author, { color: isBuyer ? tokens.color.userBubbleText : tokens.color.gold }]}>
        {authorLabel}
      </Text>
      <Text style={[styles.body, { color: isBuyer ? tokens.color.userBubbleText : tokens.color.textPrimary }]}>
        {body}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  bubble: {
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.md,
    borderRadius: tokens.radius.lg,
    marginBottom: tokens.space.sm,
    borderWidth: 1,
    maxWidth: '88%'
  },
  bubbleBuyer: {
    backgroundColor: tokens.color.userBubbleBg,
    borderColor: tokens.color.goldDeep,
    alignSelf: 'flex-end',
    borderBottomRightRadius: 6
  },
  bubbleSeller: {
    backgroundColor: tokens.color.aiBubbleBg,
    borderColor: tokens.color.aiBubbleBorder,
    borderTopWidth: 2,
    borderTopColor: tokens.color.aiBubbleTopAccent,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 6
  },
  author: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4
  },
  body: { fontSize: 15, lineHeight: 22 }
})
