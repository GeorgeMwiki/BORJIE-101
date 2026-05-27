import { useCallback, useMemo, useState } from 'react'
import { StyleSheet, Switch, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Field } from '../../src/forms/Field'
import { Dropdown } from '../../src/forms/Dropdown'
import { Button } from '../../src/forms/Button'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-23'

type RoleValue = 'owner' | 'manager' | 'employee'

interface OrgToggle {
  readonly id: string
  readonly label: string
  readonly hint: string
  readonly enabled: boolean
}

interface TeamMember {
  readonly id: string
  readonly name: string
  readonly role: RoleValue
  readonly email: string
}

const INITIAL_TOGGLES: ReadonlyArray<OrgToggle> = [
  { id: 'mt', label: 'Mfumo wa Multi-Tenant', hint: 'Tenga data kwa kila kampuni', enabled: true },
  { id: 'br', label: 'Brand-Lock', hint: 'Funga rangi na nembo za Borjie', enabled: true },
  { id: 'cu', label: 'Sarafu ya msingi TZS', hint: 'Kataa mikataba ya USD ya ndani', enabled: true },
  { id: 'sw', label: 'Kiswahili-Kwanza', hint: 'UI inaanza na lugha ya Kiswahili', enabled: true }
]

const ROLE_OPTIONS = [
  { value: 'owner' as const, label: 'Mmiliki (owner)' },
  { value: 'manager' as const, label: 'Meneja (manager)' },
  { value: 'employee' as const, label: 'Mfanyakazi (employee)' }
] as const

const SEED_TEAM: ReadonlyArray<TeamMember> = [
  { id: 't1', name: 'Bwana Mkubwa', role: 'owner', email: 'mkubwa@borjie.tz' },
  { id: 't2', name: 'Meneja wa Geita', role: 'manager', email: 'geita@borjie.tz' },
  { id: 't3', name: 'Asha Mwakasege', role: 'employee', email: 'asha@borjie.tz' }
]

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <SettingsAndBilling />
      </ScreenShell>
    </RoleGuard>
  )
}

function SettingsAndBilling(): JSX.Element {
  const [toggles, setToggles] = useState<ReadonlyArray<OrgToggle>>(INITIAL_TOGGLES)
  const [team, setTeam] = useState<ReadonlyArray<TeamMember>>(SEED_TEAM)
  const [inviteName, setInviteName] = useState<string>('')
  const [inviteEmail, setInviteEmail] = useState<string>('')
  const [inviteRole, setInviteRole] = useState<RoleValue | null>(null)
  const [lastQueuedId, setLastQueuedId] = useState<string | null>(null)

  const flip = useCallback((id: string): void => {
    setToggles((current) =>
      current.map((row) => (row.id === id ? { ...row, enabled: !row.enabled } : row))
    )
  }, [])

  const submit = useCallback((): void => {
    if (inviteName.trim().length === 0 || inviteEmail.trim().length === 0 || !inviteRole) {
      return
    }
    const next: TeamMember = {
      id: `t-${team.length + 1}`,
      name: inviteName.trim(),
      role: inviteRole,
      email: inviteEmail.trim()
    }
    setTeam([...team, next])
    setLastQueuedId(next.id)
    setInviteName('')
    setInviteEmail('')
    setInviteRole(null)
  }, [inviteName, inviteEmail, inviteRole, team])

  const inviteDisabled = useMemo<boolean>(
    () => inviteName.trim().length === 0 || inviteEmail.trim().length === 0 || !inviteRole,
    [inviteName, inviteEmail, inviteRole]
  )

  return (
    <View>
      <Section title="Mipangilio ya Kampuni" hint="Geuza vifaa vya msingi vya kampuni yako">
        {toggles.map((row) => (
          <View key={row.id} style={styles.toggleRow}>
            <View style={styles.toggleText}>
              <Text style={styles.toggleLabel}>{row.label}</Text>
              <Text style={styles.toggleHint}>{row.hint}</Text>
            </View>
            <Switch
              value={row.enabled}
              onValueChange={() => flip(row.id)}
              trackColor={{ false: colors.border, true: colors.gold }}
              thumbColor={row.enabled ? colors.goldDark : colors.surfaceAlt}
              accessibilityLabel={row.label}
            />
          </View>
        ))}
      </Section>

      <Section title="Karibisha mwanachama" hint="Tuma mwaliko kwa barua pepe">
        <Field
          label="Jina kamili"
          value={inviteName}
          onChangeText={setInviteName}
          placeholder="Mfano: Juma Mwangi"
        />
        <Field
          label="Barua pepe"
          value={inviteEmail}
          onChangeText={setInviteEmail}
          placeholder="jina@kampuni.tz"
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Dropdown
          label="Cheo"
          value={inviteRole}
          onChange={setInviteRole}
          options={ROLE_OPTIONS}
          placeholder="Chagua cheo"
        />
        <Button label="Tuma mwaliko" onPress={submit} disabled={inviteDisabled} />
        {lastQueuedId ? (
          <Text style={styles.queued}>Mwaliko umewekwa kwenye foleni · {lastQueuedId}</Text>
        ) : null}
      </Section>

      <Section title="Timu yako" hint={`Wanachama ${team.length} kwa jumla`}>
        {team.map((member) => (
          <View key={member.id} style={styles.memberRow}>
            <View style={styles.memberBody}>
              <Text style={styles.memberName}>{member.name}</Text>
              <Text style={styles.memberMeta}>{member.email}</Text>
            </View>
            <View style={[styles.badge, badgeStyle(member.role)]}>
              <Text style={styles.badgeText}>{roleLabel(member.role)}</Text>
            </View>
          </View>
        ))}
      </Section>

      <Section title="Mpango wa sasa" hint="Bili inayofuata: 2026-06-15">
        <View style={styles.planCard}>
          <Text style={styles.planTier}>Pro · TZS 980,000 / mwezi</Text>
          <Text style={styles.planLine}>Hadi watumiaji 25 (sasa: {team.length})</Text>
          <Text style={styles.planLine}>Mikataba ya migodi: bila kikomo</Text>
          <Text style={styles.planLine}>Akili ya AI: kiwango cha juu</Text>
        </View>
        <Button label="Boresha mpango" variant="secondary" onPress={() => undefined} />
      </Section>
    </View>
  )
}

function roleLabel(role: RoleValue): string {
  if (role === 'owner') return 'Mmiliki'
  if (role === 'manager') return 'Meneja'
  return 'Mfanyakazi'
}

function badgeStyle(role: RoleValue): { backgroundColor: string } {
  if (role === 'owner') return { backgroundColor: colors.gold }
  if (role === 'manager') return { backgroundColor: colors.earth300 }
  return { backgroundColor: colors.surfaceAlt }
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  toggleText: {
    flex: 1,
    paddingRight: spacing.md
  },
  toggleLabel: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600'
  },
  toggleHint: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  },
  queued: {
    color: colors.success,
    fontSize: fontSize.caption,
    marginTop: spacing.sm
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  memberBody: {
    flex: 1
  },
  memberName: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600'
  },
  memberMeta: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill
  },
  badgeText: {
    color: colors.earth900,
    fontSize: fontSize.caption,
    fontWeight: '700'
  },
  planCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md
  },
  planTier: {
    color: colors.earth900,
    fontSize: fontSize.h3,
    fontWeight: '700',
    marginBottom: spacing.sm
  },
  planLine: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  }
})
