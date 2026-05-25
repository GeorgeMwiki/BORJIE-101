import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Link } from 'expo-router'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { useAuth } from '../../src/auth/useAuth'
import { useI18n } from '../../src/i18n/useI18n'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

export default function SitesTab(): JSX.Element {
  const { user } = useAuth()
  const { screen } = useI18n()
  const screenId = user?.role === 'owner' ? 'O-M-04' : 'W-M-19'

  return (
    <ScreenShell screenId={screenId}>
      <Section title="Migodi yote">
        <PlaceholderList
          items={[
            { id: 'site-a', primary: 'Mgodi A · Geita', secondary: 'PML 12345 · hai' },
            { id: 'site-b', primary: 'Mgodi B · Chunya', secondary: 'PML 67890 · subiri' },
            { id: 'site-c', primary: 'Mgodi C · Mwanza', secondary: 'PML 24680 · kazi' }
          ]}
        />
      </Section>
      <Section title="Skrini zinazohusiana">
        <View style={styles.grid}>
          {['O-M-05', 'O-M-06', 'W-M-02', 'W-M-19'].map((id) => (
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
