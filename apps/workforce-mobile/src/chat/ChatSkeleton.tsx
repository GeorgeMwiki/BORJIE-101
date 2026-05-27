/**
 * ChatSkeleton — assistant-bubble shimmer placeholder.
 *
 * Surfaces 200 ms after a user sends if no `message_chunk` has landed
 * yet, and stays visible for a minimum of 200 ms before tokens replace
 * it (NN/G: a skeleton shown for <500 ms reads as distracting flicker).
 * The shimmer is driven by a single `Animated.Value` looped via the RN
 * core Animated module so we stay off the JS bridge between frames —
 * Reanimated is preferred but the workforce-mobile bundler has it as
 * an optional dep and the chat surface must degrade cleanly.
 */
import { useEffect, useMemo, useRef } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import { colors } from '../theme/colors'
import { radius, spacing } from '../theme/spacing'

export interface ChatSkeletonProps {
  /** When true the shimmer fades in + animates. Default true. */
  readonly visible?: boolean
}

const SHIMMER_DURATION_MS = 1200

export function ChatSkeleton({ visible = true }: ChatSkeletonProps): JSX.Element | null {
  const progress = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!visible) {
      return
    }
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: SHIMMER_DURATION_MS,
        useNativeDriver: true
      })
    )
    loop.start()
    return () => {
      loop.stop()
    }
  }, [progress, visible])

  const translateX = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: [-180, 220]
      }),
    [progress]
  )

  if (!visible) {
    return null
  }

  return (
    <View
      testID="home-chat-skeleton"
      accessibilityLabel="Borjie inajibu"
      accessibilityRole="progressbar"
      style={styles.wrap}
    >
      <View style={styles.bar} />
      <Animated.View
        pointerEvents="none"
        style={[styles.shimmer, { transform: [{ translateX }] }]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    width: '60%',
    height: 48,
    backgroundColor: colors.earth100,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginVertical: spacing.xs
  },
  bar: {
    flex: 1,
    backgroundColor: colors.earth100
  },
  shimmer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 120,
    backgroundColor: colors.surface,
    opacity: 0.55
  }
})
