import { useEffect, useRef } from 'react'
import { ActivityIndicator, Animated, StyleSheet, Text, View } from 'react-native'
import { tokens } from './tokens'

export interface LitFinSplashProps {
  readonly wordmark?: string
  readonly tagline?: string
  readonly showSpinner?: boolean
  readonly testID?: string
}

/**
 * LitFin splash — navy ground, gold wordmark with letter-space
 * reveal, soft tagline, optional spinner. The brand reveal pattern
 * mirrors the LitFin web hero's eyebrow-then-title rhythm.
 */
export function LitFinSplash({
  wordmark = 'BORJIE',
  tagline,
  showSpinner = true,
  testID
}: LitFinSplashProps): JSX.Element {
  const opacity = useRef(new Animated.Value(0)).current
  const translateY = useRef(new Animated.Value(8)).current
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 420, useNativeDriver: true })
    ]).start()
  }, [opacity, translateY])
  return (
    <View testID={testID} style={styles.splash}>
      <Animated.View style={{ opacity, transform: [{ translateY }] }}>
        <Text accessibilityRole="header" style={styles.wordmark}>
          {wordmark}
        </Text>
        {tagline ? <Text style={styles.tagline}>{tagline}</Text> : null}
      </Animated.View>
      {showSpinner ? <ActivityIndicator color={tokens.color.gold} style={styles.spinner} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: tokens.color.bgBase,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: tokens.space.xl
  },
  wordmark: {
    color: tokens.color.gold,
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: 6,
    textAlign: 'center'
  },
  tagline: {
    ...tokens.type.body,
    color: tokens.color.textSecondary,
    marginTop: tokens.space.md,
    textAlign: 'center'
  },
  spinner: {
    marginTop: tokens.space.xl
  }
})
