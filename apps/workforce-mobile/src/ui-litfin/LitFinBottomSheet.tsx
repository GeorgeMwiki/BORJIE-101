import type { ReactNode } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { tokens } from './tokens'

export interface LitFinBottomSheetProps {
  readonly visible: boolean
  readonly onClose: () => void
  readonly title?: string
  readonly subtitle?: string
  readonly children: ReactNode
  readonly testID?: string
}

/**
 * LitFin bottom sheet — slate-deep card on a navy overlay, gold drag
 * handle, 24px radius top corners only. Used for confirmations,
 * forms, choosers (e.g. site pickers, shift swap dialogs).
 */
export function LitFinBottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  testID
}: LitFinBottomSheetProps): JSX.Element {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID={testID}
    >
      <Pressable accessibilityRole="button" style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheetWrap} onPress={(e) => e.stopPropagation()}>
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <View style={styles.handle} />
            {title ? <Text style={styles.title}>{title}</Text> : null}
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
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
    backgroundColor: 'rgba(7, 10, 18, 0.78)',
    justifyContent: 'flex-end'
  },
  sheetWrap: {
    width: '100%'
  },
  sheet: {
    backgroundColor: tokens.color.bgSurface,
    borderTopLeftRadius: tokens.radius.xl,
    borderTopRightRadius: tokens.radius.xl,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: tokens.color.border,
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.lg
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: tokens.color.borderStrong,
    marginBottom: tokens.space.lg
  },
  title: {
    ...tokens.type.h3,
    color: tokens.color.textPrimary,
    marginBottom: tokens.space.xs
  },
  subtitle: {
    ...tokens.type.bodySm,
    color: tokens.color.textSecondary,
    marginBottom: tokens.space.md
  },
  body: {
    marginTop: tokens.space.sm
  }
})
