import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { Button } from '../../src/forms/Button'
import { FingerprintPlaceholder } from '../../src/components/FingerprintPlaceholder'
import { request } from '../../src/api/client'
import { API_BASE_URL } from '../../src/api/config'
import { ApiError, isNetworkError } from '../../src/api/errors'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-25'

const COPY = Object.freeze({
  loading: 'Inakusanya entries za audit-trail…',
  errorInline: 'Imeshindwa kupakua entries za audit-trail.',
  emptyHint: 'Hakuna entries za audit-trail kwa akaunti yako bado.',
  sectionSummary: 'Muhtasari',
  sectionInclusions: 'Vifaa vinavyojumuishwa',
  sectionInclusionsHint: 'Ushahidi kamili kwa mdhibiti (kutoka audit-trail)',
  sectionPackages: 'Historia ya pakeji',
  sectionPackagesHint: 'Pakeji moja kwa kila robo ya mwaka',
  sectionSign: 'Saini ya kuondoa pakeji',
  sectionSignHint: 'Idhinisha kwa kidole',
  startNew: 'Anzisha pakeji ya robo hii',
  startingNow: 'Inazalishwa…',
  exportLabel: 'Hamisha bundle (JSON)',
  exportBusy: 'Inahamisha…',
  exportUnavailable: 'Haipatikani',
  exportSucceeded: 'Bundle imehifadhiwa kwa export.',
  exportFailed: 'Export ya bundle imeshindwa.'
})

const AUDIT_BASE = `${API_BASE_URL}/api/v1/audit-trail`

interface AuditEntry {
  readonly id: string
  readonly tenantId: string
  readonly sequenceId: number
  readonly occurredAt: string
  readonly actorKind: string
  readonly actorDisplay: string | null
  readonly actionKind: string
  readonly actionCategory: string
  readonly decision?: string | null
  readonly createdAt: string
}

interface EntriesEnvelope {
  readonly success: boolean
  readonly data?: ReadonlyArray<AuditEntry>
  readonly meta?: { limit: number; offset: number; count: number }
  readonly error?: { code?: string; message?: string }
}

interface BundleEnvelope {
  readonly success: boolean
  readonly data?: Readonly<Record<string, unknown>>
  readonly error?: { code?: string; message?: string }
}

interface PackageSummary {
  readonly id: string
  readonly quarter: string
  readonly periodLabel: string
  readonly startIso: string
  readonly endIso: string
  readonly entryCount: number
  readonly latestEntryAt: string
  readonly status: 'ready' | 'empty'
}

const INCLUDED_SECTIONS: ReadonlyArray<{ readonly id: string; readonly label: string }> = [
  { id: 's1', label: 'Maamuzi yote ya AI (ai_autonomous / ai_proposal)' },
  { id: 's2', label: 'Vitendo vya wanadamu (human_action / human_approval)' },
  { id: 's3', label: 'Mlolongo wa hash (prev_hash → this_hash)' },
  { id: 's4', label: 'Saini za chain (per-entry signature)' },
  { id: 's5', label: 'Evidence attachments per row' }
]

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <AuditPackagesView />
      </ScreenShell>
    </RoleGuard>
  )
}

function AuditPackagesView(): JSX.Element {
  const queryClient = useQueryClient()
  const [actionMessage, setActionMessage] = useState<string | null>(null)

  const entriesQuery = useQuery<ReadonlyArray<AuditEntry>, Error>({
    queryKey: ['audit-trail', 'entries'],
    queryFn: async ({ signal }) => {
      const envelope = await request<EntriesEnvelope>(`${AUDIT_BASE}/entries?limit=500`, {
        signal
      })
      if (!envelope.success) {
        throw new Error(envelope.error?.message ?? COPY.errorInline)
      }
      return envelope.data ?? []
    }
  })

  const bundleMutation = useMutation<
    Readonly<Record<string, unknown>>,
    Error,
    { from: string; to: string }
  >({
    mutationFn: async (input) => {
      const params = new URLSearchParams({ from: input.from, to: input.to })
      const envelope = await request<BundleEnvelope>(
        `${AUDIT_BASE}/bundle?${params.toString()}`
      )
      if (!envelope.success || !envelope.data) {
        throw new Error(envelope.error?.message ?? COPY.exportFailed)
      }
      return envelope.data
    },
    onSuccess: async () => {
      setActionMessage(COPY.exportSucceeded)
      await queryClient.invalidateQueries({ queryKey: ['audit-trail'] })
    },
    onError: () => {
      setActionMessage(COPY.exportFailed)
    }
  })

  const entries = entriesQuery.data ?? []

  const packages = useMemo<ReadonlyArray<PackageSummary>>(() => {
    return computeQuarterlyPackages(entries)
  }, [entries])

  const currentQuarter = useMemo(() => computeCurrentQuarter(new Date()), [])

  const startNewPackage = useCallback((): void => {
    setActionMessage(null)
    bundleMutation.mutate({
      from: currentQuarter.startIso,
      to: currentQuarter.endIso
    })
  }, [bundleMutation, currentQuarter])

  const exportPackage = useCallback(
    (summary: PackageSummary): void => {
      setActionMessage(null)
      bundleMutation.mutate({ from: summary.startIso, to: summary.endIso })
    },
    [bundleMutation]
  )

  if (entriesQuery.isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.gold} />
        <Text style={styles.loadingLabel}>{COPY.loading}</Text>
      </View>
    )
  }

  if (entriesQuery.isError) {
    return (
      <View>
        {isBackendUnavailable(entriesQuery.error) ? (
          <PreviewBanner kind="env-missing" />
        ) : (
          <Text style={styles.errorInline}>{COPY.errorInline}</Text>
        )}
      </View>
    )
  }

  if (entries.length === 0) {
    return (
      <View>
        <PreviewBanner kind="no-data" />
        <Text style={styles.emptyHint}>{COPY.emptyHint}</Text>
      </View>
    )
  }

  return (
    <View>
      <Section
        title={COPY.sectionSummary}
        hint={`Entries ${entries.length} · ${packages.length} robo`}
      >
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>
            Pakeji ya Ukaguzi · {currentQuarter.label}
          </Text>
          <Text style={styles.summaryLine}>
            Kipindi: {formatDate(currentQuarter.startIso)} → {formatDate(currentQuarter.endIso)}
          </Text>
          <Text style={styles.summaryLine}>Endpoint: POST /api/v1/audit-trail/bundle</Text>
        </View>
        <Button
          label={bundleMutation.isPending ? COPY.startingNow : COPY.startNew}
          onPress={startNewPackage}
          disabled={bundleMutation.isPending}
        />
      </Section>

      <Section title={COPY.sectionInclusions} hint={COPY.sectionInclusionsHint}>
        {INCLUDED_SECTIONS.map((row) => (
          <View key={row.id} style={styles.itemRow}>
            <View style={styles.dot} />
            <Text style={styles.itemText}>{row.label}</Text>
          </View>
        ))}
      </Section>

      <Section title={COPY.sectionPackages} hint={COPY.sectionPackagesHint}>
        {packages.length === 0 ? (
          <Text style={styles.emptyHint}>{COPY.emptyHint}</Text>
        ) : (
          packages.map((pkg) => (
            <View key={pkg.id} style={styles.packageRow}>
              <View style={styles.packageHead}>
                <Text style={styles.packageQuarter}>{pkg.quarter}</Text>
                <View style={[styles.statusPill, statusPillStyle(pkg.status)]}>
                  <Text style={styles.statusPillText}>{statusLabel(pkg.status)}</Text>
                </View>
              </View>
              <Text style={styles.packageMeta}>{pkg.periodLabel}</Text>
              <Text style={styles.packageMeta}>
                Entries {pkg.entryCount} · ya mwisho {formatDate(pkg.latestEntryAt)}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Hamisha ${pkg.quarter}`}
                onPress={() => exportPackage(pkg)}
                disabled={bundleMutation.isPending}
                style={({ pressed }) => [
                  styles.exportBtn,
                  bundleMutation.isPending ? styles.exportBtnDisabled : null,
                  pressed && !bundleMutation.isPending ? styles.exportBtnPressed : null
                ]}
              >
                <Text style={styles.exportBtnText}>
                  {bundleMutation.isPending ? COPY.exportBusy : COPY.exportLabel}
                </Text>
              </Pressable>
            </View>
          ))
        )}
        {actionMessage ? (
          <Text
            style={
              actionMessage === COPY.exportSucceeded
                ? styles.exportedNote
                : styles.errorInline
            }
          >
            {actionMessage}
          </Text>
        ) : null}
      </Section>

      <Section title={COPY.sectionSign} hint={COPY.sectionSignHint}>
        <FingerprintPlaceholder label="Idhinisha kupakua" />
      </Section>
    </View>
  )
}

function computeQuarterlyPackages(
  entries: ReadonlyArray<AuditEntry>
): ReadonlyArray<PackageSummary> {
  if (entries.length === 0) return []
  const groups = new Map<string, AuditEntry[]>()
  for (const entry of entries) {
    const occurred = Date.parse(entry.occurredAt)
    if (!Number.isFinite(occurred)) continue
    const date = new Date(occurred)
    const quarter = Math.floor(date.getUTCMonth() / 3) + 1
    const key = `Q${quarter}-${date.getUTCFullYear()}`
    const bucket = groups.get(key)
    if (bucket) {
      bucket.push(entry)
    } else {
      groups.set(key, [entry])
    }
  }
  const summaries: PackageSummary[] = []
  for (const [key, bucket] of groups.entries()) {
    const [quarterRaw, yearRaw] = key.split('-')
    const year = Number(yearRaw)
    const quarterNum = Number(quarterRaw?.slice(1))
    if (!Number.isFinite(year) || !Number.isFinite(quarterNum)) continue
    const startMonth = (quarterNum - 1) * 3
    const startIso = new Date(Date.UTC(year, startMonth, 1)).toISOString()
    const endIso = new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999)).toISOString()
    const latest = bucket.reduce<string>((acc, e) => {
      return e.occurredAt > acc ? e.occurredAt : acc
    }, bucket[0]?.occurredAt ?? startIso)
    summaries.push({
      id: `${key}`,
      quarter: `${quarterRaw} ${year}`,
      periodLabel: `${formatDate(startIso)} → ${formatDate(endIso)}`,
      startIso,
      endIso,
      entryCount: bucket.length,
      latestEntryAt: latest,
      status: bucket.length > 0 ? 'ready' : 'empty'
    })
  }
  return summaries.sort((a, b) => b.startIso.localeCompare(a.startIso))
}

function computeCurrentQuarter(now: Date): {
  label: string
  startIso: string
  endIso: string
} {
  const year = now.getUTCFullYear()
  const quarter = Math.floor(now.getUTCMonth() / 3) + 1
  const startMonth = (quarter - 1) * 3
  const startIso = new Date(Date.UTC(year, startMonth, 1)).toISOString()
  const endIso = new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999)).toISOString()
  return { label: `Q${quarter} ${year}`, startIso, endIso }
}

function statusLabel(status: PackageSummary['status']): string {
  if (status === 'ready') return 'Tayari'
  return 'Tupu'
}

function statusPillStyle(status: PackageSummary['status']): { backgroundColor: string } {
  if (status === 'ready') return { backgroundColor: colors.success }
  return { backgroundColor: colors.earth300 }
}

function formatDate(iso: string): string {
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return iso
  return new Date(parsed).toISOString().slice(0, 10)
}

function isBackendUnavailable(error: unknown): boolean {
  if (isNetworkError(error)) return true
  if (error instanceof ApiError) return error.status >= 500 || error.status === 503
  return false
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    paddingVertical: spacing.xl
  },
  loadingLabel: {
    color: colors.textMuted,
    marginTop: spacing.sm,
    fontSize: fontSize.body
  },
  errorInline: {
    color: colors.danger,
    fontSize: fontSize.body,
    fontWeight: '600',
    marginVertical: spacing.md
  },
  emptyHint: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  summaryCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md
  },
  summaryTitle: {
    color: colors.earth900,
    fontSize: fontSize.h3,
    fontWeight: '700',
    marginBottom: spacing.sm
  },
  summaryLine: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.gold,
    marginRight: spacing.md
  },
  itemText: {
    color: colors.text,
    fontSize: fontSize.body,
    flex: 1
  },
  packageRow: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md
  },
  packageHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm
  },
  packageQuarter: {
    color: colors.earth900,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  statusPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill
  },
  statusPillText: {
    color: colors.textInverse,
    fontSize: fontSize.caption,
    fontWeight: '700'
  },
  packageMeta: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  },
  exportBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.gold,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center'
  },
  exportBtnDisabled: {
    backgroundColor: colors.border
  },
  exportBtnPressed: {
    backgroundColor: colors.goldDark
  },
  exportBtnText: {
    color: colors.earth900,
    fontWeight: '700',
    fontSize: fontSize.body
  },
  exportedNote: {
    color: colors.success,
    fontSize: fontSize.caption,
    marginTop: spacing.sm,
    fontWeight: '600'
  }
})
