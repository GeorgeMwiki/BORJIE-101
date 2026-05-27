/**
 * ChatSkeleton — assistant-bubble shimmer placeholder for buyer-mobile.
 *
 * Mirrors the workforce-mobile component but uses the buyer-mobile
 * palette (forest/cream). Surfaces 200 ms after a user sends if no
 * stream chunk has landed yet, and stays visible for a minimum of
 * 200 ms before tokens replace it (R7 §11.3 timing table — NN/G).
 * Shimmer animation runs on the native driver so it survives a slow
 * JS bridge on cheap 3G devices.
 */
import { useEffect, useMemo, useRef } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import { colors } from '@/theme/colors'
import { radius, spacing } from '@/theme/spacing'

export interface ChatSkeletonProps {
  readonly visible?: boolean
}

const SHIMMER_DURATION_MS = 1200

export function ChatSkeleton({ visible = true }: ChatSkeletonProps) {
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
      testID="buyer-chat-skeleton"
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
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
    marginVertical: spacing.xs
  },
  bar: {
    flex: 1,
    backgroundColor: colors.cream
  },
  shimmer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 120,
    backgroundColor: colors.white,
    opacity: 0.55
  }
})
