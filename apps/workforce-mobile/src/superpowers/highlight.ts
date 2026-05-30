/**
 * Superpower 3 — highlight.
 *
 * Web equivalent flashes a CSS pulse on a CSS selector. RN has no
 * selectors so we publish a `target` string (e.g. "task-card-123") and
 * the receiving component subscribes via {@link useSuperpowerHighlight}
 * to drive a reanimated pulse on its own ref.
 */
import { useEffect, useRef, useState } from 'react'
import { Animated, Easing } from 'react-native'
import { highlightBus, type HighlightEvent } from './bus'

export interface HighlightState {
  readonly pulse: Animated.Value
  readonly active: boolean
}

export function publishHighlight(event: HighlightEvent): void {
  highlightBus.publish(event)
}

/**
 * Drive a 1200ms pulse whenever a highlight event for `target` lands.
 *
 * Usage:
 *   const { pulse, active } = useSuperpowerHighlight('task-card-123')
 *   <Animated.View style={{ transform: [{ scale: pulse }] }}>
 */
export function useSuperpowerHighlight(target: string, ttlMs = 1200): HighlightState {
  const pulse = useRef(new Animated.Value(1)).current
  const [active, setActive] = useState(false)

  useEffect(() => {
    const unsubscribe = highlightBus.subscribe((event) => {
      if (event.target !== target) return
      setActive(true)
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.04,
          duration: (event.ttlMs ?? ttlMs) / 2,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: (event.ttlMs ?? ttlMs) / 2,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true
        })
      ]).start(() => setActive(false))
    })
    return unsubscribe
  }, [target, pulse, ttlMs])

  return { pulse, active }
}
