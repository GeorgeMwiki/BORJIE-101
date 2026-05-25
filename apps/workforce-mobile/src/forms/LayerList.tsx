import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Field } from './Field'
import { Button } from './Button'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'
import type { DrillLayer } from './schemas/drillHole'

export interface LayerListProps {
  layers: ReadonlyArray<DrillLayer>
  draft: DraftLayer
  onChangeDraft: (next: DraftLayer) => void
  onAdd: () => void
  onRemove: (id: string) => void
  addLabel: string
  removeLabel: string
  typeLabel: string
  fromLabel: string
  toLabel: string
  emptyLabel: string
}

export interface DraftLayer {
  type: string
  fromMeters: string
  toMeters: string
}

export const EMPTY_DRAFT: DraftLayer = { type: '', fromMeters: '', toMeters: '' }

export function LayerList({
  layers,
  draft,
  onChangeDraft,
  onAdd,
  onRemove,
  addLabel,
  removeLabel,
  typeLabel,
  fromLabel,
  toLabel,
  emptyLabel
}: LayerListProps): JSX.Element {
  const canAdd =
    draft.type.length > 0 &&
    draft.fromMeters.length > 0 &&
    draft.toMeters.length > 0
  return (
    <View>
      {layers.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyLabel}>{emptyLabel}</Text>
        </View>
      ) : (
        layers.map((layer) => (
          <View key={layer.id} style={styles.row}>
            <View style={styles.rowInfo}>
              <Text style={styles.rowType}>{layer.type}</Text>
              <Text style={styles.rowRange}>
                {layer.fromMeters} m - {layer.toMeters} m
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={removeLabel}
              onPress={() => onRemove(layer.id)}
              style={styles.remove}
            >
              <Text style={styles.removeLabel}>{removeLabel}</Text>
            </Pressable>
          </View>
        ))
      )}
      <View style={styles.draftBox}>
        <Field
          label={typeLabel}
          value={draft.type}
          onChangeText={(value) => onChangeDraft({ ...draft, type: value })}
        />
        <View style={styles.draftRow}>
          <View style={styles.draftCol}>
            <Field
              label={fromLabel}
              value={draft.fromMeters}
              onChangeText={(value) => onChangeDraft({ ...draft, fromMeters: value })}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={styles.draftCol}>
            <Field
              label={toLabel}
              value={draft.toMeters}
              onChangeText={(value) => onChangeDraft({ ...draft, toMeters: value })}
              keyboardType="decimal-pad"
            />
          </View>
        </View>
        <Button label={addLabel} variant="secondary" disabled={!canAdd} onPress={onAdd} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  empty: {
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm
  },
  emptyLabel: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm
  },
  rowInfo: {
    flex: 1
  },
  rowType: {
    color: colors.earth900,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  rowRange: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  remove: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.danger
  },
  removeLabel: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: fontSize.caption
  },
  draftBox: {
    backgroundColor: colors.earth100,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm
  },
  draftRow: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  draftCol: {
    flex: 1
  }
})
