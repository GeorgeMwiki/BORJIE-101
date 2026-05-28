import { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, View, type ViewStyle } from 'react-native'

export interface LitFinSkeletonProps {
  readonly height?: number
  readonly width?: number | string
  readonly radius?: number
  readonly style?: ViewStyle
}

/**
 * LitFin skeleton shimmer — soft gold-tinted block that pulses
 * between two opacities. Matches the web `<Skeleton />` recipe.
 */
export function LitFinSkeleton({
  height = 14,
  width = '100%',
  radius = 8,
  style
}: LitFinSkeletonProps): JSX.Element {
  const pulse = useRef(new Animated.Value(0.4)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true
        }),
        Animated.timing(pulse, {
          toValue: 0.4,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true
        })
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [pulse])

  return (
    <Animated.View
      style={[
        styles.bar,
        // RN typing accepts `width: number | string`, but our prop union
        // is wider; the cast is safe because RN passes it straight to layout.
        { height, width: width as number, borderRadius: radius, opacity: pulse },
        style
      ]}
    />
  )
}

export interface LitFinSkeletonStackProps {
  readonly lines?: number
  readonly gap?: number
  readonly heightPerLine?: number
}

/** Convenience: stack of skeleton rows for paragraph placeholders. */
export function LitFinSkeletonStack({
  lines = 3,
  gap = 8,
  heightPerLine = 12
}: LitFinSkeletonStackProps): JSX.Element {
  return (
    <View style={{ gap }}>
      {Array.from({ length: lines }).map((_, idx) => {
        const isLast = idx === lines - 1
        const widthPct = isLast ? '60%' : idx % 2 === 0 ? '92%' : '80%'
        return <LitFinSkeleton key={idx} height={heightPerLine} width={widthPct} />
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: 'rgba(255, 200, 87, 0.16)'
  }
})
