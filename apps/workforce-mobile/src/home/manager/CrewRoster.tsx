import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { miningApi } from '../../api/client'
import { PreviewBanner } from '../../components/PreviewBanner'
import { Section } from '../../components/Section'
import { useI18n } from '../../i18n/useI18n'
import { colors } from '../../theme/colors'
import { fontSize, radius, spacing } from '../../theme/spacing'
import { pickCopy, pickStatus } from './copy'
import { classifyEndpointError, endpointPathFromError } from './missingApi'
import type { CrewMember, CrewStatus } from './types'

/**
 * Band 3 — Crew Roster. Vertical list (R3 §2 mobile decision; map is opt-in,
 * never default). Each row: avatar initials + colored dot + name/role +
 * status pill + workload bar. Tap target ≥56pt vertical per research §9
 * (above WCAG 44pt minimum).
 */

interface CrewRosterProps {
  readonly siteId: string | null
}

interface AttendanceResponse {
  readonly items: ReadonlyArray<CrewMember>
}

function useAttendance(siteId: string | null): UseQueryResult<AttendanceResponse, Error> {
  return useQuery<AttendanceResponse, Error>({
    queryKey: ['manager', 'attendance', siteId ?? 'auto'],
    queryFn: ({ signal }) =>
      miningApi.get<AttendanceResponse>('/attendance', {
        signal,
        query: {
          shift: 'current',
          ...(siteId ? { siteId } : {})
        }
      }),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false
  })
}

export function CrewRoster({ siteId }: CrewRosterProps): JSX.Element {
  const { lang } = useI18n()
  const query = useAttendance(siteId)
  const title = pickCopy(lang, 'bandCrew')

  if (query.isLoading) {
    return (
      <Section title={title}>
        <ActivityIndicator color={colors.gold} accessibilityLabel={pickCopy(lang, 'loading')} />
      </Section>
    )
  }

  if (query.isError) {
    const kind = classifyEndpointError(query.error)
    if (kind === 'missing') {
      return (
        <Section title={title}>
          <PreviewBanner kind="env-missing" />
          <Text style={styles.missingPath}>{endpointPathFromError(query.error)}</Text>
        </Section>
      )
    }
    return (
      <Section title={title}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void query.refetch()
          }}
          style={styles.retry}
        >
          <Text style={styles.retryLabel}>{pickCopy(lang, 'errorRetry')}</Text>
        </Pressable>
      </Section>
    )
  }

  const items = query.data?.items ?? []
  if (items.length === 0) {
    return (
      <Section title={title}>
        <Text style={styles.empty}>{pickCopy(lang, 'emptyCrew')}</Text>
      </Section>
    )
  }

  return (
    <Section title={title}>
      <View style={styles.list}>
        {items.map((member) => (
          <CrewRow key={member.id} member={member} />
        ))}
      </View>
    </Section>
  )
}

function CrewRow({ member }: { readonly member: CrewMember }): JSX.Element {
  const { lang } = useI18n()
  const initials = buildInitials(member.fullName)
  const tone = statusTone(member.status)
  const statusLabel = pickStatus(lang, member.status)
  const workloadLabel = `${pickCopy(lang, 'workloadLabel')}: ${member.workloadPct}%`
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${member.fullName} — ${statusLabel} — ${workloadLabel}`}
      style={styles.row}
    >
      <View style={[styles.avatar, { borderColor: tone }]}>
        <Text style={styles.avatarInitials}>{initials}</Text>
        <View style={[styles.statusDot, { backgroundColor: tone }]} accessibilityElementsHidden />
      </View>
      <View style={styles.body}>
        <Text style={styles.name}>{member.fullName}</Text>
        <View style={styles.metaRow}>
          <View style={[styles.statusPill, { borderColor: tone }]}>
            <Text style={[styles.statusPillText, { color: tone }]}>
              {`${statusLabel} · ${member.statusDetail}`}
            </Text>
          </View>
          {member.equipmentPaired ? (
            <Text style={styles.equipment} numberOfLines={1}>
              {member.equipmentPaired}
            </Text>
          ) : null}
        </View>
        <WorkloadBar pct={member.workloadPct} />
      </View>
    </Pressable>
  )
}

function WorkloadBar({ pct }: { readonly pct: number }): JSX.Element {
  const safe = Math.max(0, Math.min(100, pct))
  const tone = safe >= 85 ? colors.danger : safe >= 60 ? colors.warn : colors.success
  return (
    <View style={styles.barTrack} accessibilityElementsHidden>
      <View style={[styles.barFill, { width: `${safe}%`, backgroundColor: tone }]} />
    </View>
  )
}

function buildInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/u)
  if (parts.length === 0 || parts[0] === undefined) {
    return '?'
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }
  const first = parts[0].charAt(0)
  const last = parts[parts.length - 1]?.charAt(0) ?? ''
  return `${first}${last}`.toUpperCase()
}

function statusTone(status: CrewStatus): string {
  if (status === 'on_site') {
    return colors.success
  }
  if (status === 'late') {
    return colors.warn
  }
  if (status === 'absent') {
    return colors.danger
  }
  if (status === 'break') {
    return colors.earth500
  }
  return colors.textMuted
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 2,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center'
  },
  avatarInitials: { fontSize: fontSize.body, fontWeight: '700', color: colors.earth900 },
  statusDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: radius.pill,
    right: -1,
    bottom: -1,
    borderWidth: 2,
    borderColor: colors.surface
  },
  body: { flex: 1, gap: spacing.xs },
  name: { fontSize: fontSize.body, fontWeight: '600', color: colors.earth900 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  statusPill: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2
  },
  statusPillText: { fontSize: fontSize.caption, fontWeight: '600' },
  equipment: { fontSize: fontSize.caption, color: colors.textMuted, flexShrink: 1 },
  barTrack: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    overflow: 'hidden'
  },
  barFill: { height: 6, borderRadius: radius.pill },
  empty: { color: colors.textMuted, fontSize: fontSize.body },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md },
  retryLabel: { color: colors.danger, fontSize: fontSize.body, fontWeight: '600' },
  missingPath: { fontSize: fontSize.caption, color: colors.textMuted, marginTop: spacing.xs }
})

// Pure helpers exported for tests.
export const __test__ = Object.freeze({ buildInitials, statusTone })
