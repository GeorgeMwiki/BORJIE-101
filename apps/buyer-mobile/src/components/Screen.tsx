import { ReactNode } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors } from '@/theme/colors'
import { spacing } from '@/theme/spacing'

export interface ScreenProps {
  readonly children: ReactNode
  readonly scroll?: boolean
  readonly padded?: boolean
}

export function Screen({ children, scroll = true, padded = true }: ScreenProps) {
  const inner = padded ? <View style={styles.padded}>{children}</View> : children
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {inner}
        </ScrollView>
      ) : (
        <View style={styles.flex}>{inner}</View>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bone },
  scroll: { paddingBottom: spacing.xxxl },
  flex: { flex: 1 },
  padded: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg }
})
