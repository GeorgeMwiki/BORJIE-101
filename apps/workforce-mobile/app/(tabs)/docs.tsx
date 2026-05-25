import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Link } from 'expo-router'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { useI18n } from '../../src/i18n/useI18n'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const DOC_LINKS: ReadonlyArray<string> = ['O-M-08', 'O-M-09', 'O-M-19', 'O-M-25', 'W-M-20']

export default function DocsTab(): JSX.Element {
  const { screen } = useI18n()
  return (
    <ScreenShell screenId="O-M-08">
      <Section title="Hati na ripoti">
        <View style={styles.grid}>
          {DOC_LINKS.map((id) => (
            <Link key={id} href={hrefFor(id)} asChild>
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

function hrefFor(id: string): string {
  return id.startsWith('O-M-') ? `/owner/${id}` : `/worker/${id}`
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
