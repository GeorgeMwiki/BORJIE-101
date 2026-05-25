import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'
import { useI18n } from '../i18n/useI18n'

type ButtonState = 'idle' | 'listening' | 'reply'

export interface AskBorjieProps {
  label?: string
}

/**
 * Fat round voice button. Tap once -> "Listening…" placeholder, tap again ->
 * a stubbed Borjie reply. Real STT/TTS hooks land in the voice phase.
 */
export function AskBorjie({ label }: AskBorjieProps): JSX.Element {
  const { t } = useI18n()
  const [state, setState] = useState<ButtonState>('idle')

  const onPress = useCallback((): void => {
    setState((prev) => {
      if (prev === 'idle') {
        return 'listening'
      }
      if (prev === 'listening') {
        return 'reply'
      }
      return 'idle'
    })
  }, [])

  const visibleLabel = label ?? t.app.askBorjie

  return (
    <View style={styles.wrapper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={visibleLabel}
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          pressed ? styles.buttonPressed : null
        ]}
      >
        <Text style={styles.buttonText}>{visibleLabel}</Text>
      </Pressable>
      {state === 'listening' ? (
        <Text style={styles.statusListening}>{t.app.listening}</Text>
      ) : null}
      {state === 'reply' ? (
        <Text style={styles.statusReply}>{t.app.borjieReply}</Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    paddingVertical: spacing.lg
  },
  button: {
    width: 160,
    height: 160,
    borderRadius: radius.pill,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.earth900,
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6
  },
  buttonPressed: {
    backgroundColor: colors.goldDark
  },
  buttonText: {
    color: colors.earth900,
    fontSize: fontSize.h3,
    fontWeight: '700'
  },
  statusListening: {
    marginTop: spacing.md,
    color: colors.earth700,
    fontSize: fontSize.lead,
    fontStyle: 'italic'
  },
  statusReply: {
    marginTop: spacing.md,
    color: colors.earth900,
    fontSize: fontSize.lead,
    fontWeight: '600'
  }
})
