import { StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'
import type { ChatMessage } from './types'

export interface MessageBubbleProps {
  message: ChatMessage
  sourcesLabel: string
  thinkingLabel: string
}

export function MessageBubble({
  message,
  sourcesLabel,
  thinkingLabel
}: MessageBubbleProps): JSX.Element {
  const isUser = message.role === 'user'
  const placeholder = message.streaming && message.content.length === 0
  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        <Text style={isUser ? styles.textUser : styles.textAssistant}>
          {placeholder ? thinkingLabel : message.content}
        </Text>
        {message.evidence.length > 0 ? (
          <View style={styles.evidenceWrap}>
            <Text style={styles.evidenceLabel}>{sourcesLabel}</Text>
            <View style={styles.chipsRow}>
              {message.evidence.map((chip) => (
                <View key={chip.id} style={styles.chip}>
                  <Text style={styles.chipText}>{chip.label}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginVertical: spacing.xs
  },
  rowUser: {
    justifyContent: 'flex-end'
  },
  rowAssistant: {
    justifyContent: 'flex-start'
  },
  bubble: {
    maxWidth: '85%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.lg
  },
  bubbleUser: {
    backgroundColor: colors.gold
  },
  bubbleAssistant: {
    backgroundColor: colors.earth100,
    borderWidth: 1,
    borderColor: colors.border
  },
  textUser: {
    color: colors.earth900,
    fontSize: fontSize.body,
    lineHeight: 20
  },
  textAssistant: {
    color: colors.earth900,
    fontSize: fontSize.body,
    lineHeight: 20
  },
  evidenceWrap: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  evidenceLabel: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase'
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs
  },
  chip: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.earth500,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill
  },
  chipText: {
    color: colors.earth700,
    fontSize: fontSize.caption,
    fontWeight: '600'
  }
})
