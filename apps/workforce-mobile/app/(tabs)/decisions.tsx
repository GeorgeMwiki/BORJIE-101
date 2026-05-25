import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Link } from 'expo-router'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { useI18n } from '../../src/i18n/useI18n'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const DECISION_LINKS: ReadonlyArray<string> = [
  'O-M-03',
  'O-M-11',
  'O-M-15',
  'O-M-16',
  'O-M-25'
]

export default function DecisionsTab(): JSX.Element {
  const { screen } = useI18n()
  return (
    <ScreenShell screenId="O-M-03">
      <Section title="Mambo ya kuamua">
        <View style={styles.grid}>
          {DECISION_LINKS.map((id) => (
            <Link key={id} href={`/owner/${id}`} asChild>
              <Pressable style={({ pressed }) => [styles.chip, pressed ? styles.chipPressed : null]}>
                <Text style={styles.chipCode}>{id}</Text>
                <Text style={styles.chipTitle} numberOfLines={2}>
                  {screen(id).title}
                </Text>
              </Pressable>
            </Link>
          ))}
        </View>
      </Section>
    </ScreenShell>
  )
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  chip: {
    width: '48%',
    padding: spacing.md,
    backgroundColor: colors.earth100,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border
  },
  chipPressed: {
    backgroundColor: colors.earth300
  },
  chipCode: {
    color: colors.goldDark,
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 1
  },
  chipTitle: {
    color: colors.text,
    fontSize: fontSize.body,
    marginTop: spacing.xs,
    fontWeight: '600'
  }
})
