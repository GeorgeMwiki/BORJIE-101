import { StyleSheet, Text, View } from 'react-native'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'

export interface TimelineItem {
  readonly id: string
  readonly title: string
  readonly subtitle?: string
}

export interface TimelineProps {
  readonly items: readonly TimelineItem[]
}

export function Timeline({ items }: TimelineProps) {
  return (
    <View style={styles.wrap}>
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1
        return (
          <View key={item.id} style={styles.row}>
            <View style={styles.left}>
              <View style={styles.dot} />
              {isLast ? null : <View style={styles.line} />}
            </View>
            <View style={styles.body}>
              <Text style={styles.title}>{item.title}</Text>
              {item.subtitle ? <Text style={styles.subtitle}>{item.subtitle}</Text> : null}
            </View>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  left: { width: 24, alignItems: 'center' },
  dot: {
    width: 12,
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.forest,
    marginTop: 6
  },
  line: { width: 2, flex: 1, backgroundColor: colors.line, marginTop: 2 },
  body: { flex: 1, paddingLeft: spacing.md, paddingBottom: spacing.md },
  title: { ...typography.bodyStrong, color: colors.ink },
  subtitle: { ...typography.caption, color: colors.inkMuted, marginTop: 2 }
})
