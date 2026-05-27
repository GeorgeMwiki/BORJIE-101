import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { Field } from '../../src/forms/Field'
import { Dropdown } from '../../src/forms/Dropdown'
import { Button } from '../../src/forms/Button'
import { request } from '../../src/api/client'
import { API_BASE_URL } from '../../src/api/config'
import { ApiError } from '../../src/api/errors'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-23'

const COPY = Object.freeze({
  loading: 'Inapakia mipangilio...',
  orgSettings: 'Mipangilio ya Kampuni',
  orgSettingsHint: 'Geuza vifaa vya msingi vya kampuni yako',
  inviteSection: 'Karibisha mwanachama',
  inviteHint: 'Tuma mwaliko kwa mtu mpya',
  inviteName: 'Jina kamili',
  inviteNamePh: 'Mfano: Juma Mwangi',
  invitePhone: 'Simu',
  invitePhonePh: '+255 7XX XXX XXX',
  inviteRole: 'Cheo',
  inviteRolePh: 'Chagua cheo',
  inviteSubmit: 'Tuma mwaliko',
  inviteQueued: (id: string): string => `Mwaliko umewekwa kwenye foleni - ${id}`,
  teamSection: 'Timu yako',
  teamCount: (n: number): string => `Wanachama ${n} kwa jumla`,
  planSection: 'Mpango wa sasa',
  planNextInvoice: (iso: string | null): string =>
    iso ? `Bili inayofuata: ${iso.slice(0, 10)}` : 'Bili haijapangwa',
  planUsersLine: (count: number): string => `Watumiaji: ${count}`,
  planUpgrade: 'Boresha mpango',
  toggleMultiTenant: 'Mfumo wa Multi-Tenant',
  toggleMultiTenantHint: 'Tenga data kwa kila kampuni',
  toggleBrandLock: 'Brand-Lock',
  toggleBrandLockHint: 'Funga rangi na nembo za Borjie',
  toggleCurrency: 'Sarafu ya msingi TZS',
  toggleCurrencyHint: 'Kataa mikataba ya USD ya ndani',
  toggleLang: 'Kiswahili-Kwanza',
  toggleLangHint: 'UI inaanza na lugha ya Kiswahili'
})

type RoleValue = 'owner' | 'manager' | 'employee'

const ROLE_OPTIONS = [
  { value: 'owner' as const, label: 'Mmiliki (owner)' },
  { value: 'manager' as const, label: 'Meneja (manager)' },
  { value: 'employee' as const, label: 'Mfanyakazi (employee)' }
] as const

interface BrandingPayload {
  readonly aiPersonaDisplayName?: string
  readonly aiPersonaHonorific?: string
  readonly aiGreeting?: string
  readonly aiPronoun?: string
  readonly multiTenant?: boolean
  readonly brandLock?: boolean
  readonly primaryCurrency?: string
  readonly defaultLang?: string
}

interface BrandingResponse {
  readonly success?: boolean
  readonly data?: BrandingPayload
}

interface TeamMember {
  readonly id: string
  readonly name: string
  readonly role: RoleValue
  readonly phone?: string
  readonly email?: string
}

interface AdminUsersResponse {
  readonly success?: boolean
  readonly data?: ReadonlyArray<{
    readonly id: string
    readonly name?: string
    readonly fullName?: string
    readonly firstName?: string
    readonly lastName?: string
    readonly role?: string
    readonly phone?: string
    readonly email?: string
  }>
}

interface BillingSubscription {
  readonly plan: string | null
  readonly status: string | null
  readonly renewalAt: string | null
  readonly currency: string | null
  readonly mrrMinor: number
  readonly seats: number
}

interface BillingResponse {
  readonly success?: boolean
  readonly data?: BillingSubscription
}

function isTrue(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value === 'true' || value === '1'
  return fallback
}

function tenantBrandingUrl(): string {
  return `${API_BASE_URL}/api/v1/tenant-branding`
}

function adminUsersUrl(): string {
  return `${API_BASE_URL}/api/v1/admin/users`
}

function billingUrl(): string {
  return `${API_BASE_URL}/api/v1/billing/subscription`
}

function useTenantBranding(): UseQueryResult<BrandingPayload, Error> {
  return useQuery<BrandingPayload, Error>({
    queryKey: ['owner', 'tenant-branding'],
    queryFn: async ({ signal }) => {
      const response = await request<BrandingResponse>(tenantBrandingUrl(), {
        method: 'GET',
        signal
      })
      return response?.data ?? {}
    },
    staleTime: 60_000
  })
}

function useUpdateBranding(): UseMutationResult<BrandingPayload, Error, BrandingPayload> {
  const queryClient = useQueryClient()
  return useMutation<BrandingPayload, Error, BrandingPayload>({
    mutationFn: async (patch) => {
      const response = await request<BrandingResponse>(tenantBrandingUrl(), {
        method: 'PUT',
        body: patch
      })
      return response?.data ?? {}
    },
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: ['owner', 'tenant-branding'] })
      const previous = queryClient.getQueryData<BrandingPayload>(['owner', 'tenant-branding'])
      queryClient.setQueryData<BrandingPayload>(['owner', 'tenant-branding'], (current) => ({
        ...(current ?? {}),
        ...patch
      }))
      return { previous } as unknown as BrandingPayload
    },
    onError: (_err, _patch, ctx) => {
      const previous = (ctx as unknown as { previous?: BrandingPayload } | undefined)?.previous
      if (previous) {
        queryClient.setQueryData(['owner', 'tenant-branding'], previous)
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner', 'tenant-branding'] })
    }
  })
}

function useAdminUsers(): UseQueryResult<ReadonlyArray<TeamMember>, Error> {
  return useQuery<ReadonlyArray<TeamMember>, Error>({
    queryKey: ['owner', 'admin-users'],
    queryFn: async ({ signal }) => {
      const response = await request<AdminUsersResponse>(adminUsersUrl(), {
        method: 'GET',
        signal
      })
      const rows = Array.isArray(response?.data) ? response.data : []
      return rows.map((row) => {
        const fallbackName =
          row.fullName ?? row.name ?? `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim()
        const role: RoleValue =
          row.role === 'owner' || row.role === 'manager' || row.role === 'employee'
            ? row.role
            : 'employee'
        return {
          id: row.id,
          name: fallbackName || row.id,
          role,
          phone: row.phone,
          email: row.email
        }
      })
    },
    staleTime: 60_000
  })
}

function useInviteUser(): UseMutationResult<
  TeamMember,
  Error,
  { name: string; phone: string; role: RoleValue }
> {
  const queryClient = useQueryClient()
  return useMutation<TeamMember, Error, { name: string; phone: string; role: RoleValue }>({
    mutationFn: async (input) => {
      const response = await request<{ success?: boolean; data?: TeamMember }>(adminUsersUrl(), {
        method: 'POST',
        body: input
      })
      if (!response?.data) {
        throw new Error('Invite response missing data')
      }
      return response.data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner', 'admin-users'] })
    }
  })
}

function useBilling(): UseQueryResult<BillingSubscription | null, Error> {
  return useQuery<BillingSubscription | null, Error>({
    queryKey: ['owner', 'billing'],
    queryFn: async ({ signal }) => {
      const response = await request<BillingResponse>(billingUrl(), { method: 'GET', signal })
      return response?.data ?? null
    },
    staleTime: 60_000
  })
}

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
  const brandingQuery = useTenantBranding()
  const usersQuery = useAdminUsers()
  const billingQuery = useBilling()
  const updateBranding = useUpdateBranding()
  const invite = useInviteUser()
  const [inviteName, setInviteName] = useState<string>('')
  const [invitePhone, setInvitePhone] = useState<string>('')
  const [inviteRole, setInviteRole] = useState<RoleValue | null>(null)
  const [lastQueuedId, setLastQueuedId] = useState<string | null>(null)

  const branding = brandingQuery.data
  const team = usersQuery.data ?? []
  const billing = billingQuery.data ?? null

  const submit = useCallback((): void => {
    if (inviteName.trim().length === 0 || invitePhone.trim().length === 0 || !inviteRole) {
      return
    }
    invite.mutate(
      {
        name: inviteName.trim(),
        phone: invitePhone.trim(),
        role: inviteRole
      },
      {
        onSuccess: (member) => {
          setLastQueuedId(member.id)
          setInviteName('')
          setInvitePhone('')
          setInviteRole(null)
        }
      }
    )
  }, [invite, inviteName, invitePhone, inviteRole])

  const inviteDisabled = useMemo<boolean>(
    () =>
      invite.isPending ||
      inviteName.trim().length === 0 ||
      invitePhone.trim().length === 0 ||
      !inviteRole,
    [invite.isPending, inviteName, invitePhone, inviteRole]
  )

  if (brandingQuery.isLoading || usersQuery.isLoading || billingQuery.isLoading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={colors.gold} />
        <Text style={styles.loadingText}>{COPY.loading}</Text>
      </View>
    )
  }

  const fatalError =
    (brandingQuery.isError ? brandingQuery.error : null) ??
    (billingQuery.isError ? billingQuery.error : null)
  if (fatalError) {
    const status = fatalError instanceof ApiError ? fatalError.status : -1
    const kind = status === 0 ? 'offline' : 'env-missing'
    return (
      <View>
        <PreviewBanner kind={kind} />
      </View>
    )
  }

  const multiTenant = isTrue(branding?.multiTenant, true)
  const brandLock = isTrue(branding?.brandLock, true)
  const tzsPrimary = (branding?.primaryCurrency ?? 'TZS').toUpperCase() === 'TZS'
  const swFirst = (branding?.defaultLang ?? 'sw') === 'sw'

  const flipBranding = (key: keyof BrandingPayload, value: unknown): void => {
    updateBranding.mutate({ [key]: value } as BrandingPayload)
  }

  return (
    <View>
      <Section title={COPY.orgSettings} hint={COPY.orgSettingsHint}>
        <ToggleRow
          label={COPY.toggleMultiTenant}
          hint={COPY.toggleMultiTenantHint}
          value={multiTenant}
          onChange={(next) => flipBranding('multiTenant', next)}
        />
        <ToggleRow
          label={COPY.toggleBrandLock}
          hint={COPY.toggleBrandLockHint}
          value={brandLock}
          onChange={(next) => flipBranding('brandLock', next)}
        />
        <ToggleRow
          label={COPY.toggleCurrency}
          hint={COPY.toggleCurrencyHint}
          value={tzsPrimary}
          onChange={(next) => flipBranding('primaryCurrency', next ? 'TZS' : 'USD')}
        />
        <ToggleRow
          label={COPY.toggleLang}
          hint={COPY.toggleLangHint}
          value={swFirst}
          onChange={(next) => flipBranding('defaultLang', next ? 'sw' : 'en')}
        />
      </Section>

      <Section title={COPY.inviteSection} hint={COPY.inviteHint}>
        {usersQuery.isError ? <PreviewBanner kind="env-missing" /> : null}
        <Field
          label={COPY.inviteName}
          value={inviteName}
          onChangeText={setInviteName}
          placeholder={COPY.inviteNamePh}
        />
        <Field
          label={COPY.invitePhone}
          value={invitePhone}
          onChangeText={setInvitePhone}
          placeholder={COPY.invitePhonePh}
          keyboardType="phone-pad"
        />
        <Dropdown<RoleValue>
          label={COPY.inviteRole}
          value={inviteRole}
          onChange={setInviteRole}
          options={ROLE_OPTIONS}
          placeholder={COPY.inviteRolePh}
        />
        <Button
          label={COPY.inviteSubmit}
          onPress={submit}
          disabled={inviteDisabled}
          loading={invite.isPending}
        />
        {lastQueuedId ? (
          <Text style={styles.queued}>{COPY.inviteQueued(lastQueuedId)}</Text>
        ) : null}
      </Section>

      <Section title={COPY.teamSection} hint={COPY.teamCount(team.length)}>
        {team.length === 0 ? (
          <PreviewBanner kind="no-data" />
        ) : (
          team.map((member) => (
            <View key={member.id} style={styles.memberRow}>
              <View style={styles.memberBody}>
                <Text style={styles.memberName}>{member.name}</Text>
                <Text style={styles.memberMeta}>{member.email ?? member.phone ?? ''}</Text>
              </View>
              <View style={[styles.badge, badgeStyle(member.role)]}>
                <Text style={styles.badgeText}>{roleLabel(member.role)}</Text>
              </View>
            </View>
          ))
        )}
      </Section>

      <Section title={COPY.planSection} hint={COPY.planNextInvoice(billing?.renewalAt ?? null)}>
        {billing ? (
          <View style={styles.planCard}>
            <Text style={styles.planTier}>{billing.plan ?? '-'}</Text>
            <Text style={styles.planLine}>
              {COPY.planUsersLine(billing.seats || team.length)}
            </Text>
            <Text style={styles.planLine}>
              {billing.currency ?? '-'} - {billing.mrrMinor}
            </Text>
            <Text style={styles.planLine}>Status: {billing.status ?? '-'}</Text>
          </View>
        ) : (
          <PreviewBanner kind="no-data" />
        )}
        <Button label={COPY.planUpgrade} variant="secondary" onPress={() => undefined} />
      </Section>
    </View>
  )
}

interface ToggleRowProps {
  readonly label: string
  readonly hint: string
  readonly value: boolean
  readonly onChange: (next: boolean) => void
}

function ToggleRow({ label, hint, value, onChange }: ToggleRowProps): JSX.Element {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: colors.gold }}
        thumbColor={value ? colors.goldDark : colors.surfaceAlt}
        accessibilityLabel={label}
      />
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
  loadingWrap: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  loadingText: { color: colors.textMuted, fontSize: fontSize.body },
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
