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
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <ReportView lang="sw" />
      </ScreenShell>
    </RoleGuard>
  )
}

function ReportView({ lang }: { lang: 'sw' | 'en' }): JSX.Element {
  const isSw = lang === 'sw'
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
        description: isSw
          ? `Ripoti ya haraka kutoka kwa mfanyakazi (${severity}).`
          : `Worker one-tap SOS report (${severity}).`,
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
        <Text style={styles.title}>{isSw ? 'Imepokelewa' : 'Received'}</Text>
        <Text style={styles.subtitle}>
          {isSw
            ? 'Meneja wako ataona ripoti yako mara moja.'
            : 'Your manager will see this report immediately.'}
        </Text>
        <Text style={styles.reference}>
          {isSw ? 'Kumbukumbu: ' : 'Reference: '}
          {mutation.data.id}
        </Text>
      </View>
    )
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>
        {isSw ? 'Ripoti tukio' : 'Report an incident'}
      </Text>
      <Text style={styles.subtitle}>
        {isSw
          ? 'Bonyeza kiwango cha hatari. Meneja ataona haraka.'
          : 'Tap the severity. Your manager sees it instantly.'}
      </Text>

      <Section title={isSw ? 'Kiwango cha hatari' : 'Severity'}>
        {mutation.isPending ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.gold} />
            <Text style={styles.subtitle}>
              {isSw ? 'Inatuma ripoti...' : 'Sending report...'}
            </Text>
          </View>
        ) : (
          <View style={styles.grid}>
            <Button
              label={isSw ? 'Chini' : 'Low'}
              onPress={() => onPress('low')}
              variant="ghost"
            />
            <Button
              label={isSw ? 'Wastani' : 'Medium'}
              onPress={() => onPress('medium')}
              variant="ghost"
            />
            <Button label={isSw ? 'Juu' : 'High'} onPress={() => onPress('high')} />
            <Button
              label={isSw ? 'HATARI' : 'CRITICAL'}
              onPress={() => onPress('critical')}
              variant="danger"
            />
          </View>
        )}
        {mutation.isError ? (
          <Text style={styles.errorText}>
            {isSw
              ? 'Imeshindwa kutuma ripoti. Meneja HAJAPOKEA bado — bonyeza tena.'
              : 'Failed to send the report. Your manager was NOT notified — tap again to retry.'}
          </Text>
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
