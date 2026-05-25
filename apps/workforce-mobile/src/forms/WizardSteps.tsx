import { StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'

export interface WizardStepsProps {
  total: number
  current: number
  labels?: ReadonlyArray<string>
}

/**
 * Visual progress strip used at the top of multi-step forms. `current` is
 * zero-indexed. Renders as a row of pills, the active one in gold.
 */
export function WizardSteps({ total, current, labels }: WizardStepsProps): JSX.Element {
  const steps: ReadonlyArray<number> = Array.from({ length: total }, (_, index) => index)
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {steps.map((index) => {
          const isActive = index === current
          const isCompleted = index < current
          return (
            <View
              key={index}
              style={[
                styles.pill,
                isActive ? styles.pillActive : null,
                isCompleted ? styles.pillCompleted : null
              ]}
            >
              <Text
                style={[
                  styles.pillLabel,
                  isActive ? styles.pillLabelActive : null,
                  isCompleted ? styles.pillLabelCompleted : null
                ]}
              >
                {index + 1}
              </Text>
            </View>
          )
        })}
      </View>
      {labels && labels[current] ? (
        <Text style={styles.label}>{labels[current]}</Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.lg
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  pill: {
    flex: 1,
    height: 8,
    backgroundColor: colors.border,
    borderRadius: radius.pill
  },
  pillActive: {
    backgroundColor: colors.gold
  },
  pillCompleted: {
    backgroundColor: colors.earth500
  },
  pillLabel: {
    display: 'none'
  },
  pillLabelActive: {
    display: 'none'
  },
  pillLabelCompleted: {
    display: 'none'
  },
  label: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontSize: fontSize.body,
    fontWeight: '600'
  }
})
