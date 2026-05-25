import { FlatList, StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'

export interface PlaceholderItem {
  id: string
  primary: string
  secondary?: string
}

export interface PlaceholderListProps {
  items: ReadonlyArray<PlaceholderItem>
  emptyLabel?: string
}

export function PlaceholderList({ items, emptyLabel }: PlaceholderListProps): JSX.Element {
  if (items.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{emptyLabel ?? '—'}</Text>
      </View>
    )
  }
  return (
    <FlatList
      data={items as PlaceholderItem[]}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Text style={styles.primary}>{item.primary}</Text>
          {item.secondary ? <Text style={styles.secondary}>{item.secondary}</Text> : null}
        </View>
      )}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      scrollEnabled={false}
    />
  )
}

const styles = StyleSheet.create({
  empty: {
    padding: spacing.lg,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  row: {
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md
  },
  primary: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600'
  },
  secondary: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  separator: {
    height: spacing.sm
  }
})
