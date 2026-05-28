import { Pressable, StyleSheet, Text, View } from 'react-native'
import { tokens } from './tokens'

export interface LitFinSegmentedOption<T extends string> {
  readonly value: T
  readonly label: string
}

export interface LitFinSegmentedProps<T extends string> {
  readonly value: T
  readonly options: ReadonlyArray<LitFinSegmentedOption<T>>
  readonly onChange: (next: T) => void
  readonly testID?: string
}

/**
 * LitFin segmented control — `bg-slate-800 rounded-full p-1` pill
 * with gold active segment, navy text. Used for role pickers,
 * filter tabs, period toggles.
 */
export function LitFinSegmented<T extends string>({
  value,
  options,
  onChange,
  testID
}: LitFinSegmentedProps<T>): JSX.Element {
  return (
    <View testID={testID} style={styles.wrap}>
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(opt.value)}
            style={({ pressed }) => [
              styles.seg,
              active ? styles.segActive : null,
              pressed && !active ? styles.segPressed : null
            ]}
          >
            <Text style={[styles.label, active ? styles.labelActive : null]}>{opt.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    backgroundColor: tokens.color.bgRaised,
    borderRadius: tokens.radius.pill,
    padding: 4,
    borderWidth: 1,
    borderColor: tokens.color.border
  },
  seg: {
    flex: 1,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36
  },
  segActive: {
    backgroundColor: tokens.color.gold
  },
  segPressed: {
    opacity: 0.85
  },
  label: {
    ...tokens.type.bodySmStrong,
    color: tokens.color.textSecondary
  },
  labelActive: {
    color: tokens.color.userBubbleText
  }
})
