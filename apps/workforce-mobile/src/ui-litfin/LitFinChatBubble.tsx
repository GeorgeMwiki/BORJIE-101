import type { ReactNode } from 'react'
import { StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { tokens } from './tokens'

export type LitFinChatBubbleRole = 'user' | 'ai' | 'system'

export interface LitFinChatBubbleProps {
  readonly role: LitFinChatBubbleRole
  readonly text?: string
  readonly children?: ReactNode
  readonly persona?: string
  readonly style?: ViewStyle
  readonly testID?: string
}

/**
 * LitFin AI chat bubble — gold-gradient top accent on AI replies,
 * deep gold fill on user bubbles. The web LitFin ChatPanel applies the
 * same recipe via Tailwind classes; this is the RN translation.
 *
 *   AI bubble  : navy raised + 2px gold top border + cream text
 *   User bubble: gold fill + navy text
 *   System     : muted hairline + secondary text
 */
export function LitFinChatBubble({
  role,
  text,
  children,
  persona,
  style,
  testID
}: LitFinChatBubbleProps): JSX.Element {
  const palette = roleStyles[role]
  const isUser = role === 'user'
  return (
    <View
      testID={testID}
      style={[
        styles.row,
        { justifyContent: isUser ? 'flex-end' : 'flex-start' }
      ]}
    >
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: palette.bg,
            borderColor: palette.border,
            borderTopColor: palette.topBorder ?? palette.border,
            borderTopWidth: palette.topBorder ? 2 : 1
          },
          isUser ? styles.bubbleUser : styles.bubbleAi,
          style
        ]}
      >
        {persona && role === 'ai' ? (
          <Text style={styles.persona}>{persona}</Text>
        ) : null}
        {text ? (
          <Text style={[styles.text, { color: palette.fg }]}>{text}</Text>
        ) : null}
        {children}
      </View>
    </View>
  )
}

const roleStyles: Record<
  LitFinChatBubbleRole,
  { bg: string; border: string; topBorder?: string; fg: string }
> = {
  ai: {
    bg: tokens.color.aiBubbleBg,
    border: tokens.color.aiBubbleBorder,
    topBorder: tokens.color.aiBubbleTopAccent,
    fg: tokens.color.textPrimary
  },
  user: {
    bg: tokens.color.userBubbleBg,
    border: tokens.color.goldDeep,
    fg: tokens.color.userBubbleText
  },
  system: {
    bg: tokens.color.bgRaised,
    border: tokens.color.border,
    fg: tokens.color.textMuted
  }
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginVertical: tokens.space.xs
  },
  bubble: {
    maxWidth: '88%',
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.md,
    borderRadius: tokens.radius.lg,
    borderWidth: 1
  },
  bubbleAi: {
    borderBottomLeftRadius: 6
  },
  bubbleUser: {
    borderBottomRightRadius: 6
  },
  persona: {
    ...tokens.type.eyebrow,
    color: tokens.color.gold,
    marginBottom: tokens.space.xs
  },
  text: {
    ...tokens.type.body,
    lineHeight: 22
  }
})
