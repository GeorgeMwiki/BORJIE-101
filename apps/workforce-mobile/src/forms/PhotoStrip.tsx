import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'
import type { CapturedMedia } from '../media/usePhotoPicker'

export interface PhotoStripProps {
  photos: ReadonlyArray<CapturedMedia>
  onAdd: () => void
  onRemove: (id: string) => void
  addLabel: string
  emptyLabel?: string
  max?: number
}

/**
 * Horizontal strip of thumbnails with an "add" tile at the end. Tapping a
 * thumbnail removes it. Keeps shift-report photo capture inline with the form.
 */
export function PhotoStrip({
  photos,
  onAdd,
  onRemove,
  addLabel,
  emptyLabel,
  max = 6
}: PhotoStripProps): JSX.Element {
  const canAdd = photos.length < max
  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {photos.map((photo) => (
          <Pressable
            key={photo.id}
            accessibilityRole="button"
            accessibilityLabel="Remove photo"
            onPress={() => onRemove(photo.id)}
            style={styles.thumb}
          >
            <Image source={{ uri: photo.uri }} style={styles.thumbImage} />
            <View style={styles.removeBadge}>
              <Text style={styles.removeBadgeText}>X</Text>
            </View>
          </Pressable>
        ))}
        {canAdd ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={addLabel}
            onPress={onAdd}
            style={styles.add}
          >
            <Text style={styles.addPlus}>+</Text>
            <Text style={styles.addLabel}>{addLabel}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      {photos.length === 0 && emptyLabel ? (
        <Text style={styles.empty}>{emptyLabel}</Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.md
  },
  row: {
    gap: spacing.sm,
    paddingVertical: spacing.xs
  },
  thumb: {
    width: 96,
    height: 96,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.earth100
  },
  thumbImage: {
    width: '100%',
    height: '100%'
  },
  removeBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center'
  },
  removeBadgeText: {
    color: colors.textInverse,
    fontSize: fontSize.caption,
    fontWeight: '700'
  },
  add: {
    width: 96,
    height: 96,
    borderRadius: radius.md,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.earth500,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt
  },
  addPlus: {
    color: colors.earth700,
    fontSize: 32,
    fontWeight: '700'
  },
  addLabel: {
    color: colors.earth700,
    fontSize: fontSize.caption,
    fontWeight: '600',
    marginTop: spacing.xs
  },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  }
})
