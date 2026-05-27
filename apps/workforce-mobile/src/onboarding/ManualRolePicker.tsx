import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'
import type { Role } from '../roles/types'

export interface ManualRolePickerCopy {
  manualHeader: string
  manualOwner: string
  manualManager: string
  manualEmployee: string
}

export interface ManualRolePickerProps {
  selected: Role | null
  copy: ManualRolePickerCopy
  onPick: (role: Role) => void
}

export function ManualRolePicker({ selected, copy, onPick }: ManualRolePickerProps): JSX.Element {
  return (
    <View style={styles.block}>
      <Text style={styles.header}>{copy.manualHeader}</Text>
      <Card label={copy.manualOwner} selected={selected === 'owner'} onPress={() => onPick('owner')} />
      <Card label={copy.manualManager} selected={selected === 'manager'} onPress={() => onPick('manager')} />
      <Card
        label={copy.manualEmployee}
        selected={selected === 'employee'}
        onPress={() => onPick('employee')}
      />
    </View>
  )
}

interface CardProps {
  label: string
  selected: boolean
  onPress: () => void
}

function Card({ label, selected, onPress }: CardProps): JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        selected ? styles.cardSelected : null,
        pressed ? styles.cardPressed : null
      ]}
    >
      <Text style={[styles.cardLabel, selected ? styles.cardLabelSelected : null]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  block: {
    marginTop: spacing.md
  },
  header: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '700',
    marginBottom: spacing.sm
  },
  card: {
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 2,
    borderColor: colors.border,
    marginBottom: spacing.sm
  },
  cardSelected: {
    borderColor: colors.gold,
    backgroundColor: colors.earth100
  },
  cardPressed: {
    opacity: 0.85
  },
  cardLabel: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600'
  },
  cardLabelSelected: {
    color: colors.goldDark,
    fontWeight: '700'
  }
})
