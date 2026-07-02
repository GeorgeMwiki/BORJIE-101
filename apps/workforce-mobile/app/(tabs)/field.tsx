import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Link } from 'expo-router'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { useI18n } from '../../src/i18n/useI18n'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

// W-M-17 is intentionally OMITTED: it is a PhotoSlot/empty-PlaceholderList
// stub with no real data source (a reachable stub is a bug). It re-enters
// this list once a real photo/marks query backs it. W-M-21 (upload queue)
// is kept — it now renders the real offline write queue.
const FIELD_LINKS: ReadonlyArray<string> = [
  'W-M-02',
  'W-M-04',
  'W-M-05',
  'W-M-06',
  'W-M-07',
  'W-M-08',
  'W-M-09',
  'W-M-11',
  'W-M-12',
  'W-M-14',
  'W-M-19',
  'W-M-21'
]

export default function FieldTab(): JSX.Element {
  const { screen, t } = useI18n()
  return (
    <ScreenShell screenId="W-M-02">
      <Section title={t.tabScreens.fieldTitle}>
        <View style={styles.grid}>
          {FIELD_LINKS.map((id) => (
            <Link key={id} href={`/worker/${id}`} asChild>
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
