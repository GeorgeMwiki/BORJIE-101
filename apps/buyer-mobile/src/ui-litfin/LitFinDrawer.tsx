import type { ReactNode } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { tokens } from './tokens'

export interface LitFinDrawerProps {
  readonly visible: boolean
  readonly onClose: () => void
  readonly eyebrow?: string
  readonly title: string
  readonly children: ReactNode
  readonly side?: 'left' | 'right'
  readonly widthPercent?: number
  readonly testID?: string
}

/**
 * LitFin side drawer — slides in from right by default. Used for
 * detail navigation (audit drawer, evidence list, decision tree).
 * 88% width, slate background, gold close affordance.
 */
export function LitFinDrawer({
  visible,
  onClose,
  eyebrow,
  title,
  children,
  side = 'right',
  widthPercent = 88,
  testID
}: LitFinDrawerProps): JSX.Element {
  const sideStyle = side === 'right' ? styles.alignRight : styles.alignLeft
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID={testID}
    >
      <Pressable accessibilityRole="button" style={[styles.backdrop, sideStyle]} onPress={onClose}>
        <Pressable
          style={[styles.panelWrap, { width: `${widthPercent}%` }]}
          onPress={(e) => e.stopPropagation()}
        >
          <SafeAreaView edges={['top', 'bottom']} style={styles.panel}>
            <View style={styles.header}>
              <View style={styles.headTitle}>
                {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
                <Text style={styles.title}>{title}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>
            <View style={styles.body}>{children}</View>
          </SafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(7, 10, 18, 0.78)'
  },
  alignRight: {
    justifyContent: 'flex-end'
  },
  alignLeft: {
    justifyContent: 'flex-start'
  },
  panelWrap: {
    height: '100%'
  },
  panel: {
    flex: 1,
    backgroundColor: tokens.color.bgSurface,
    borderLeftWidth: 1,
    borderLeftColor: tokens.color.border,
    paddingHorizontal: tokens.space.xl
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: tokens.space.lg,
    borderBottomWidth: 1,
    borderBottomColor: tokens.color.border
  },
  headTitle: {
    flex: 1
  },
  eyebrow: {
    ...tokens.type.eyebrow,
    color: tokens.color.gold,
    marginBottom: tokens.space.xs
  },
  title: {
    ...tokens.type.h2,
    color: tokens.color.textPrimary
  },
  close: {
    color: tokens.color.gold,
    fontSize: 24,
    fontWeight: '700',
    paddingHorizontal: tokens.space.sm,
    paddingVertical: tokens.space.xs
  },
  body: {
    flex: 1,
    paddingTop: tokens.space.lg
  }
})
