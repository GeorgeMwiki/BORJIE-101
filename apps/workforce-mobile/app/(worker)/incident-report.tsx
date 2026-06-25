/**
 * Worker safety-incident report — chain L-C (issue #193).
 *
 * One-button SOS for low/medium reports + a "tap if critical" CTA that
 * escalates severity. Backend: POST /api/v1/mining/incidents — the
 * severity-escalator service decides the manager/owner/admin fan-out.
 *
 * The POST is awaited BEFORE the receipt renders: we only claim "your
 * manager will see this" once the server has accepted the row. On
 * failure we surface an honest error and let the worker retry — we
 * never fake a successful report on the safety path.
 */

import { useCallback, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useMutation } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Button } from '../../src/forms/Button'
import { miningApi } from '../../src/api/client'
import { ApiError } from '../../src/api/errors'
import { useLocation } from '../../src/location/useLocation'
import { useI18n } from '../../src/i18n/useI18n'
import { pickStrings } from '../../src/i18n'
import type { Lang } from '../../src/auth/types'
import { colors } from '../../src/theme/colors'
import { fontSize, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-INC'

type Severity = 'low' | 'medium' | 'high' | 'critical'

interface IncidentRow {
  readonly id: string
  readonly severity: Severity
}

interface IncidentCreateResponse {
  readonly success: true
  readonly data: IncidentRow
}

export default function IncidentReportScreen(): JSX.Element {
  const { lang } = useI18n()
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <ReportView lang={lang} />
      </ScreenShell>
    </RoleGuard>
  )
}

function ReportView({ lang }: { lang: Lang }): JSX.Element {
  const copy = pickStrings(lang).incidentReport
  const { capture } = useLocation()

  const mutation = useMutation<IncidentRow, ApiError, Severity>({
    mutationFn: async (severity) => {
      // Best-effort GPS — the location string is optional on the backend,
      // so a denied/unavailable fix must not block a safety report.
      const coords = await capture()
      const location = coords
        ? `${coords.latitude.toFixed(6)},${coords.longitude.toFixed(6)}`
        : undefined
      const resp = await miningApi.post<IncidentCreateResponse>('/incidents', {
        kind: 'safety',
        severity,
        occurredAt: new Date().toISOString(),
        // Single-language description in the worker's active locale.
        description: copy.sosDescription.replace('{{severity}}', severity),
        ...(location ? { location } : {})
      })
      return resp.data
    }
  })

  const onPress = useCallback(
    (severity: Severity): void => {
      mutation.mutate(severity)
    },
    [mutation]
  )

  if (mutation.isSuccess) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>{copy.receivedTitle}</Text>
        <Text style={styles.subtitle}>{copy.receivedBody}</Text>
        <Text style={styles.reference}>
          {copy.referenceLabel}
          {mutation.data.id}
        </Text>
      </View>
    )
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{copy.reportTitle}</Text>
      <Text style={styles.subtitle}>{copy.reportSubtitle}</Text>

      <Section title={copy.severityTitle}>
        {mutation.isPending ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.gold} />
            <Text style={styles.subtitle}>{copy.sending}</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            <Button
              label={copy.low}
              onPress={() => onPress('low')}
              variant="ghost"
            />
            <Button
              label={copy.medium}
              onPress={() => onPress('medium')}
              variant="ghost"
            />
            <Button label={copy.high} onPress={() => onPress('high')} />
            <Button
              label={copy.critical}
              onPress={() => onPress('critical')}
              variant="danger"
            />
          </View>
        )}
        {mutation.isError ? (
          <Text style={styles.errorText}>{copy.sendFailed}</Text>
        ) : null}
      </Section>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: spacing.lg, gap: spacing.md },
  title: { color: colors.text, fontSize: fontSize.h2, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: fontSize.body },
  reference: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.sm
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md
  },
  errorText: {
    color: colors.danger,
    fontSize: fontSize.body,
    fontWeight: '600',
    marginTop: spacing.md
  }
})
