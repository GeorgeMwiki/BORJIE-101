import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, StyleSheet, Text } from 'react-native'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'

export type ToastTone = 'success' | 'error' | 'info'

export interface ToastMessage {
  readonly id: string
  readonly tone: ToastTone
  readonly text: string
}

interface ToastContextValue {
  readonly show: (text: string, tone?: ToastTone) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [active, setActive] = useState<ToastMessage | null>(null)
  const opacity = useRef(new Animated.Value(0)).current

  const show = useCallback(
    (text: string, tone: ToastTone = 'success') => {
      setActive({ id: `t-${Date.now()}`, text, tone })
    },
    []
  )

  useEffect(() => {
    if (!active) {
      return
    }
    Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start()
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(({ finished }) => {
        if (finished) {
          setActive(null)
        }
      })
    }, 2_500)
    return () => clearTimeout(timer)
  }, [active, opacity])

  const value = useMemo<ToastContextValue>(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {active ? (
        <Animated.View pointerEvents="none" style={[styles.wrap, { opacity }, toneStyle(active.tone)]}>
          <Text style={styles.text}>{active.text}</Text>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  )
}

function toneStyle(tone: ToastTone) {
  switch (tone) {
    case 'success':
      return { backgroundColor: colors.forest }
    case 'error':
      return { backgroundColor: colors.danger }
    case 'info':
    default:
      return { backgroundColor: colors.earth }
  }
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return ctx
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: spacing.xxl,
    left: spacing.lg,
    right: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center'
  },
  text: { ...typography.bodyStrong, color: colors.bone, textAlign: 'center' }
})
