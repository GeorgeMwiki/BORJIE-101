import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Link } from 'expo-router'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { useAuth } from '../../src/auth/useAuth'
import { SCREEN_ROLE_ACCESS } from '../../src/roles/access'
import { useI18n } from '../../src/i18n/useI18n'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

/**
 * Role-aware home tab.
 * - Owner   -> renders O-M-01 (Daily Brief) shell with quick links.
 * - Worker  -> renders W-M-02 (Today / Worker home).
 * - Manager -> renders W-M-02 with extra approvals card.
 */
export default function HomeTab(): JSX.Element {
  const { user, signOut } = useAuth()
  const { screen } = useI18n()
  const role = user?.role ?? 'employee'
  const screenId = role === 'owner' ? 'O-M-01' : 'W-M-02'

  const visibleScreens = Object.entries(SCREEN_ROLE_ACCESS)
    .filter(([, roles]) => roles.includes(role))
    .map(([id]) => id)

  return (
    <ScreenShell screenId={screenId}>
      <Section title={greetingFor(role)}>
        <Text style={styles.lead}>
          {user?.fullName ?? '—'} · {role}
        </Text>
      </Section>

      <Section title="Borjie Vision" hint="Piga picha ya eneo — pata ushauri">
        <Link href="/photo-advisor" asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Uliza picha"
            style={({ pressed }) => [styles.heroCta, pressed ? styles.heroCtaPressed : null]}
            testID="home-photo-advisor-cta"
          >
            <Text style={styles.heroCtaTitle}>Uliza picha</Text>
            <Text style={styles.heroCtaSub}>Piga picha → pata jibu la Borjie</Text>
          </Pressable>
        </Link>
      </Section>

      <Section title={screen(screenId).intent}>
        <PlaceholderList
          items={[
            { id: 'card-1', primary: '— kadi ya kwanza —' },
            { id: 'card-2', primary: '— kadi ya pili —' },
            { id: 'card-3', primary: '— kadi ya tatu —' }
          ]}
        />
      </Section>

      <Section title="Skrini zinazopatikana" hint={`${visibleScreens.length} kati ya 47`}>
        <View style={styles.grid}>
          {visibleScreens.slice(0, 8).map((id) => (
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

      <Pressable onPress={signOut} style={styles.signOut}>
        <Text style={styles.signOutText}>Toka (badilisha jukumu)</Text>
      </Pressable>
    </ScreenShell>
  )
}

function greetingFor(role: string): string {
  if (role === 'owner') {
    return 'Karibu, Bwana Mkubwa'
  }
  if (role === 'manager') {
    return 'Karibu, Meneja'
  }
  return 'Karibu, Mfanyakazi'
}

function hrefFor(id: string): string {
  if (id.startsWith('O-M-')) {
    return `/owner/${id}`
  }
  return `/worker/${id}`
}

const styles = StyleSheet.create({
  lead: {
    color: colors.text,
    fontSize: fontSize.lead
  },
  heroCta: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.gold,
    borderWidth: 1,
    borderColor: colors.goldDark,
    shadowColor: colors.earth900,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3
  },
  heroCtaPressed: {
    backgroundColor: colors.goldDark
  },
  heroCtaTitle: {
    color: colors.earth900,
    fontSize: fontSize.h2,
    fontWeight: '800'
  },
  heroCtaSub: {
    color: colors.earth800,
    fontSize: fontSize.body,
    marginTop: spacing.xs,
    fontWeight: '600'
  },
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
  },
  signOut: {
    marginTop: spacing.xl,
    alignItems: 'center'
  },
  signOutText: {
    color: colors.danger,
    fontSize: fontSize.body,
    fontWeight: '600'
  }
})
