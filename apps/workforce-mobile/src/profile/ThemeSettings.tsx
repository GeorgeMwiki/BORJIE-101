import * as React from 'react'
import { useCallback, useMemo } from 'react'
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { colors } from '../theme/colors'
import { useTheme, type Theme } from '../theme/ThemeProvider'

/**
 * ThemeSettings — segmented three-state control for the workforce-
 * mobile profile screen. Lets the operator pin Light / Dark / System.
 *
 * Most workforce screens are tuned for sunlit field readability (gold
 * on slate) so dark stays the default, but the toggle ships now so
 * cross-app preference (web + mobile) stays consistent and the buyer
 * app inherits the same control verbatim.
 */

const OPTIONS: readonly { value: Theme; en: string; sw: string }[] = [
  { value: 'light', en: 'Light', sw: 'Mwanga' },
  { value: 'dark', en: 'Dark', sw: 'Giza' },
  { value: 'system', en: 'System', sw: 'Mfumo' },
]

export interface ThemeSettingsProps {
  readonly locale?: 'en' | 'sw'
  readonly style?: StyleProp<ViewStyle>
}

export function ThemeSettings({
  locale = 'sw',
  style,
}: ThemeSettingsProps): JSX.Element {
  const { theme, setTheme } = useTheme()

  const heading = useMemo(
    () => (locale === 'sw' ? 'Mwonekano' : 'Appearance'),
    [locale]
  )
  const subheading = useMemo(
    () =>
      locale === 'sw'
        ? 'Chagua mwonekano wa programu — utahifadhiwa kati ya vipindi.'
        : 'Pick how the app looks — your choice persists across sessions.',
    [locale]
  )

  const renderOption = useCallback(
    (option: (typeof OPTIONS)[number]) => {
      const active = theme === option.value
      return (
        <TouchableOpacity
          key={option.value}
          accessibilityRole="button"
          accessibilityLabel={
            locale === 'sw'
              ? `Weka mwonekano ${option.sw}`
              : `Set theme to ${option.en}`
          }
          accessibilityState={{ selected: active }}
          onPress={() => setTheme(option.value)}
          style={[styles.option, active && styles.optionActive]}
        >
          <Text style={[styles.optionText, active && styles.optionTextActive]}>
            {locale === 'sw' ? option.sw : option.en}
          </Text>
        </TouchableOpacity>
      )
    },
    [theme, setTheme, locale]
  )

  return (
    <View style={[styles.root, style]}>
      <Text style={styles.heading}>{heading}</Text>
      <Text style={styles.sub}>{subheading}</Text>
      <View style={styles.row}>{OPTIONS.map(renderOption)}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: colors.earth700,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  heading: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  sub: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  row: {
    flexDirection: 'row',
    backgroundColor: colors.earth800,
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  option: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  optionActive: {
    backgroundColor: colors.gold,
  },
  optionText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  optionTextActive: {
    color: colors.textInverse,
  },
})
