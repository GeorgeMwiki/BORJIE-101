import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { LitFinAvatar } from './LitFinAvatar'
import { tokens } from './tokens'

export type LitFinChatBubbleRole = 'user' | 'ai' | 'system'

export interface LitFinChatBubbleProps {
  readonly role: LitFinChatBubbleRole
  readonly text?: string
  readonly children?: ReactNode
  readonly persona?: string
  /**
   * Render the persona mark (gold-ringed avatar) to the left of AI
   * bubbles — the RN translation of the web `BorjieMark size={26}` /
   * the Flutter `CircleAvatar(Icons.auto_awesome)` beside assistant
   * replies. Defaults ON for AI rows so the buyer always sees who is
   * speaking; pass `false` for dense transcripts.
   */
  readonly showAvatar?: boolean
  /** Persona name used to seed the avatar initials. */
  readonly avatarName?: string
  /** Footer timestamp shown under the bubble (locale-formatted upstream). */
  readonly timestamp?: string
  /** Play-back affordance under AI bubbles (TTS read-aloud). */
  readonly onPlayAudio?: () => void
  readonly isPlayingAudio?: boolean
  readonly playAudioLabel?: string
  /** Offline / retry marker — adds the danger ring + queued footnote. */
  readonly pending?: boolean
  readonly pendingLabel?: string
  readonly style?: ViewStyle
  readonly testID?: string
}

/**
 * LitFin AI chat bubble — the RN translation of the canonical web
 * `ChatShellMessageRow` (packages/chat-ui/src/litfin-primitives.tsx).
 *
 *   AI bubble  : navy raised + gold top accent line + cream text, with a
 *                gold-ringed persona mark to the left.
 *   User bubble: gold fill + navy text, right-aligned, lifted shadow.
 *   System     : muted hairline + secondary text.
 *
 * Behavioural parity with the source: avatar beside AI replies, optional
 * timestamp + read-aloud row, and a pending/queued state for offline
 * sends. No language state lives here — copy is passed in by the caller
 * so the active locale is the single source of truth.
 */
export function LitFinChatBubble({
  role,
  text,
  children,
  persona,
  showAvatar,
  avatarName,
  timestamp,
  onPlayAudio,
  isPlayingAudio = false,
  playAudioLabel,
  pending = false,
  pendingLabel,
  style,
  testID
}: LitFinChatBubbleProps): JSX.Element {
  const palette = roleStyles[role]
  const isUser = role === 'user'
  const isAi = role === 'ai'
  const withAvatar = isAi && (showAvatar ?? true)
  const showFooter = Boolean(timestamp) || (isAi && Boolean(onPlayAudio))

  return (
    <View
      testID={testID}
      style={[styles.row, { justifyContent: isUser ? 'flex-end' : 'flex-start' }]}
    >
      {withAvatar ? (
        <View style={styles.avatarSlot}>
          <LitFinAvatar name={avatarName ?? persona ?? 'Mr. Mwikila'} size={32} />
        </View>
      ) : null}

      <View style={styles.column}>
        <View
          style={[
            styles.bubble,
            {
              backgroundColor: palette.bg,
              borderColor: pending ? tokens.color.danger : palette.border
            },
            isUser ? styles.bubbleUser : null,
            isAi ? styles.bubbleAi : null,
            isUser ? tokens.shadow.glow : isAi ? tokens.shadow.card : null,
            style
          ]}
        >
          {isAi ? <View style={styles.accent} /> : null}
          {persona && isAi ? <Text style={styles.persona}>{persona}</Text> : null}
          {text ? (
            <Text style={[styles.text, { color: palette.fg }]}>{text}</Text>
          ) : null}
          {children}
          {pending ? (
            <Text
              style={[
                styles.pending,
                { color: isUser ? tokens.color.textInverse : tokens.color.danger }
              ]}
            >
              {pendingLabel ?? 'Queued — will retry when back online.'}
            </Text>
          ) : null}
        </View>

        {showFooter ? (
          <View
            style={[styles.footer, { justifyContent: isUser ? 'flex-end' : 'flex-start' }]}
          >
            {timestamp ? <Text style={styles.timestamp}>{timestamp}</Text> : null}
            {isAi && onPlayAudio ? (
              <Pressable
                onPress={onPlayAudio}
                accessibilityRole="button"
                accessibilityLabel={playAudioLabel ?? 'Play audio'}
                accessibilityState={{ selected: isPlayingAudio }}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.playBtn,
                  isPlayingAudio ? styles.playBtnActive : null,
                  pressed ? styles.playBtnPressed : null
                ]}
              >
                <View style={[styles.playGlyph, isPlayingAudio ? styles.playGlyphActive : null]} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  )
}

const roleStyles: Record<
  LitFinChatBubbleRole,
  { bg: string; border: string; fg: string }
> = {
  ai: {
    bg: tokens.color.aiBubbleBg,
    border: tokens.color.aiBubbleBorder,
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
    alignItems: 'flex-end',
    gap: tokens.space.sm,
    marginVertical: tokens.space.xs
  },
  avatarSlot: {
    marginBottom: 2
  },
  column: {
    maxWidth: '85%',
    minWidth: 0
  },
  bubble: {
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.md,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    overflow: 'hidden'
  },
  bubbleAi: {
    borderBottomLeftRadius: 6
  },
  bubbleUser: {
    borderBottomRightRadius: 6
  },
  // Gold gradient-feel accent bar pinned to the top edge of AI bubbles —
  // the RN stand-in for the web `from-primary/40 via-emerald to-cyan` line.
  accent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: tokens.color.aiBubbleTopAccent
  },
  persona: {
    ...tokens.type.eyebrow,
    color: tokens.color.gold,
    marginBottom: tokens.space.xs
  },
  text: {
    ...tokens.type.body,
    lineHeight: 22
  },
  pending: {
    ...tokens.type.micro,
    marginTop: tokens.space.xs
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
    marginTop: tokens.space.xs,
    paddingHorizontal: tokens.space.xs
  },
  timestamp: {
    ...tokens.type.micro,
    color: tokens.color.textMuted
  },
  playBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center'
  },
  playBtnActive: {
    backgroundColor: tokens.color.goldRing
  },
  playBtnPressed: {
    opacity: 0.7
  },
  // Simple play/read-aloud glyph built from a View (no icon dep) — a small
  // triangle that turns gold while playing.
  playGlyph: {
    width: 0,
    height: 0,
    borderTopWidth: 5,
    borderBottomWidth: 5,
    borderLeftWidth: 8,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: tokens.color.textMuted,
    marginLeft: 2
  },
  playGlyphActive: {
    borderLeftColor: tokens.color.gold
  }
})
