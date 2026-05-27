import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { request } from '../../src/api/client'
import { API_BASE_URL } from '../../src/api/config'
import { ApiError, isNetworkError } from '../../src/api/errors'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-19'

const COPY = Object.freeze({
  loading: 'Inapakia maktaba ya ripoti…',
  errorInline: 'Imeshindwa kupakua orodha ya ripoti.',
  emptyHint: 'Hakuna ripoti za maingiliano zilizopatikana kwenye akaunti yako.',
  shareMissing: 'POST /api/v1/mining/reports/{id}/share haipatikani kwa sasa.',
  sectionFilter: 'Chuja kwa aina ya render',
  sectionReports: 'Ripoti za maingiliano',
  shareLabel: 'Fungua kiunga (signed URL)',
  shareUnavailableLabel: 'Hakuna kiunga cha signed URL',
  metaGenerated: 'Imezalishwa',
  metaExpires: 'Inakwisha',
  metaActions: 'Vitendo',
  filterAll: 'Zote'
})

const REPORTS_BASE = `${API_BASE_URL}/api/v1/interactive-reports`

interface InteractiveReportRow {
  readonly id: string
  readonly reportInstanceId: string
  readonly version: number
  readonly renderKind: string
  readonly signedUrl: string | null
  readonly signedUrlKey: string | null
  readonly expiresAt: string | null
  readonly contentHash: string | null
  readonly generatedAt: string
  readonly generatedBy: string | null
  readonly mediaReferences: ReadonlyArray<unknown> | null
  readonly actionPlans: ReadonlyArray<unknown> | null
  readonly createdAt: string
}

interface ReportsListEnvelope {
  readonly success: boolean
  readonly data?: ReadonlyArray<InteractiveReportRow>
  readonly error?: { code?: string; message?: string }
}

export default function Screen(): JSX.Element {
  const [filter, setFilter] = useState<string>('all')
  const [openError, setOpenError] = useState<string | null>(null)

  const query = useQuery<ReadonlyArray<InteractiveReportRow>, Error>({
    queryKey: ['interactive-reports', 'list'],
    queryFn: async ({ signal }) => {
      const envelope = await request<ReportsListEnvelope>(REPORTS_BASE, { signal })
      if (!envelope.success) {
        throw new Error(envelope.error?.message ?? COPY.errorInline)
      }
      return envelope.data ?? []
    }
  })

  const reports = query.data ?? []

  const renderKinds = useMemo<ReadonlyArray<string>>(() => {
    const unique = new Set<string>()
    reports.forEach((r) => unique.add(r.renderKind))
    return Array.from(unique).sort()
  }, [reports])

  const visible = useMemo<ReadonlyArray<InteractiveReportRow>>(() => {
    if (filter === 'all') return reports
    return reports.filter((r) => r.renderKind === filter)
  }, [filter, reports])

  const openSignedUrl = async (report: InteractiveReportRow): Promise<void> => {
    setOpenError(null)
    if (!report.signedUrl) {
      setOpenError(COPY.shareUnavailableLabel)
      return
    }
    try {
      const supported = await Linking.canOpenURL(report.signedUrl)
      if (!supported) {
        setOpenError(COPY.shareUnavailableLabel)
        return
      }
      await Linking.openURL(report.signedUrl)
    } catch {
      setOpenError(COPY.shareUnavailableLabel)
    }
  }

  if (query.isPending) {
    return (
      <RoleGuard screenId={SCREEN_ID}>
        <ScreenShell screenId={SCREEN_ID}>
          <View style={styles.center}>
            <ActivityIndicator color={colors.gold} />
            <Text style={styles.loadingLabel}>{COPY.loading}</Text>
          </View>
        </ScreenShell>
      </RoleGuard>
    )
  }

  if (query.isError) {
    return (
      <RoleGuard screenId={SCREEN_ID}>
        <ScreenShell screenId={SCREEN_ID}>
          {isBackendUnavailable(query.error) ? (
            <PreviewBanner kind="env-missing" />
          ) : (
            <Text style={styles.errorInline}>{COPY.errorInline}</Text>
          )}
        </ScreenShell>
      </RoleGuard>
    )
  }

  if (reports.length === 0) {
    return (
      <RoleGuard screenId={SCREEN_ID}>
        <ScreenShell screenId={SCREEN_ID}>
          <PreviewBanner kind="no-data" />
          <Text style={styles.emptyHint}>{COPY.emptyHint}</Text>
        </ScreenShell>
      </RoleGuard>
    )
  }

  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title={COPY.sectionFilter}>
          <View style={styles.filterRow}>
            <FilterChip
              key="all"
              label={`${COPY.filterAll} (${reports.length})`}
              active={filter === 'all'}
              onPress={() => setFilter('all')}
            />
            {renderKinds.map((kind) => (
              <FilterChip
                key={kind}
                label={`${kind} (${reports.filter((r) => r.renderKind === kind).length})`}
                active={filter === kind}
                onPress={() => setFilter(kind)}
              />
            ))}
          </View>
        </Section>
        <Section
          title={`${COPY.sectionReports} (${visible.length})`}
          hint={COPY.shareMissing}
        >
          <View style={styles.reportList}>
            {visible.map((report) => (
              <View key={report.id} style={styles.reportCard}>
                <Text style={styles.reportTitle}>
                  {report.reportInstanceId} · v{report.version}
                </Text>
                <Text style={styles.reportMeta}>
                  {report.renderKind} · {COPY.metaGenerated} {formatDate(report.generatedAt)}
                </Text>
                {report.expiresAt ? (
                  <Text style={styles.reportMeta}>
                    {COPY.metaExpires} {formatDate(report.expiresAt)}
                  </Text>
                ) : null}
                {report.actionPlans && report.actionPlans.length > 0 ? (
                  <Text style={styles.reportMeta}>
                    {COPY.metaActions}: {report.actionPlans.length}
                  </Text>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Fungua ${report.reportInstanceId}`}
                  onPress={() => void openSignedUrl(report)}
                  disabled={!report.signedUrl}
                  style={({ pressed }) => [
                    styles.shareButton,
                    !report.signedUrl ? styles.shareButtonDisabled : null,
                    pressed && Boolean(report.signedUrl) ? styles.shareButtonPressed : null
                  ]}
                >
                  <Text
                    style={[
                      styles.shareLabel,
                      !report.signedUrl ? styles.shareLabelDisabled : null
                    ]}
                  >
                    {report.signedUrl ? COPY.shareLabel : COPY.shareUnavailableLabel}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        </Section>
        {openError ? <Text style={styles.errorInline}>{openError}</Text> : null}
      </ScreenShell>
    </RoleGuard>
  )
}

function FilterChip({
  label,
  active,
  onPress
}: {
  label: string
  active: boolean
  onPress: () => void
}): JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label}</Text>
    </Pressable>
  )
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
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt
  },
  chipActive: {
    backgroundColor: colors.gold,
    borderColor: colors.goldDark
  },
  chipLabel: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    fontWeight: '600'
  },
  chipLabelActive: {
    color: colors.earth900
  },
  reportList: {
    gap: spacing.sm
  },
  reportCard: {
    backgroundColor: colors.surfaceAlt,
    padding: spacing.md,
    borderRadius: radius.md
  },
  reportTitle: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600'
  },
  reportMeta: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  },
  shareButton: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
    backgroundColor: colors.success,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill
  },
  shareButtonPressed: {
    opacity: 0.85
  },
  shareButtonDisabled: {
    backgroundColor: colors.border
  },
  shareLabel: {
    color: colors.textInverse,
    fontSize: fontSize.body,
    fontWeight: '700'
  },
  shareLabelDisabled: {
    color: colors.textMuted
  }
})
