import { StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'

export interface BigNumberProps {
  value: string
  label: string
  caption?: string
}

export function BigNumber({ value, label, caption }: BigNumberProps): JSX.Element {
  return (
    <View style={styles.numberBox}>
      <Text style={styles.numberValue}>{value}</Text>
      <Text style={styles.numberLabel}>{label}</Text>
      {caption ? <Text style={styles.numberCaption}>{caption}</Text> : null}
    </View>
  )
}

export interface PhotoSlotProps {
  label: string
}

export function PhotoSlot({ label }: PhotoSlotProps): JSX.Element {
  return (
    <View style={styles.photo}>
      <Text style={styles.photoLabel}>{label}</Text>
    </View>
  )
}

export interface CountTapProps {
  label: string
}

export function CountTap({ label }: CountTapProps): JSX.Element {
  return (
    <View style={styles.count}>
      <Text style={styles.countLabel}>{label}</Text>
      <Text style={styles.countValue}>0</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  numberBox: {
    backgroundColor: colors.earth700,
    padding: spacing.lg,
    borderRadius: radius.md
  },
  numberValue: {
    color: colors.goldLight,
    fontSize: 48,
    fontWeight: '800'
  },
  numberLabel: {
    color: colors.textInverse,
    fontSize: fontSize.lead,
    fontWeight: '600',
    marginTop: spacing.xs
  },
  numberCaption: {
    color: colors.earth100,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  photo: {
    width: 96,
    height: 96,
    backgroundColor: colors.earth100,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center'
  },
  photoLabel: {
    color: colors.textMuted,
    fontSize: fontSize.caption
  },
  count: {
    backgroundColor: colors.gold,
    padding: spacing.xl,
    borderRadius: radius.lg,
    alignItems: 'center'
  },
  countLabel: {
    color: colors.earth900,
    fontSize: fontSize.h3,
    fontWeight: '700'
  },
  countValue: {
    color: colors.earth900,
    fontSize: 64,
    fontWeight: '800',
    marginTop: spacing.sm
  }
})
