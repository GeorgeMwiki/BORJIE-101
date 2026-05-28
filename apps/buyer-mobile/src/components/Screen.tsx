import { ReactNode } from 'react'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { tokens } from '@/ui-litfin'

export interface ScreenProps {
  readonly children: ReactNode
  readonly scroll?: boolean
  readonly padded?: boolean
  readonly refreshing?: boolean
  readonly onRefresh?: () => void
}

/**
 * LitFin-themed shell — navy-slate ground (the marketing + owner-web
 * foundation), gold pull-to-refresh tint, no inner padding by default
 * so screens own their hero rhythm.
 */
export function Screen({ children, scroll = true, padded = true, refreshing, onRefresh }: ScreenProps) {
  const inner = padded ? <View style={styles.padded}>{children}</View> : children
  const refresh =
    onRefresh !== undefined ? (
      <RefreshControl
        refreshing={Boolean(refreshing)}
        onRefresh={onRefresh}
        tintColor={tokens.color.gold}
      />
    ) : undefined
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          refreshControl={refresh}
        >
          {inner}
        </ScrollView>
      ) : (
        <View style={styles.flex}>{inner}</View>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: tokens.color.bgSurface },
  scroll: { paddingBottom: tokens.space.xxxl },
  flex: { flex: 1 },
  padded: { paddingHorizontal: tokens.space.lg, paddingTop: tokens.space.lg }
})
