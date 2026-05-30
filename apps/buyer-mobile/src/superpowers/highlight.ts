/**
 * Superpower 3 — highlight. A subscribing component drives an
 * Animated.Value pulse when an event hits its target id.
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

export function useSuperpowerHighlight(target: string, ttlMs = 1200): HighlightState {
  const pulse = useRef(new Animated.Value(1)).current
  const [active, setActive] = useState(false)

  useEffect(() => {
    return highlightBus.subscribe((event) => {
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
  }, [target, pulse, ttlMs])

  return { pulse, active }
}
