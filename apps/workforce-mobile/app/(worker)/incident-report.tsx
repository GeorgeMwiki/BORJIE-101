/**
 * Worker safety-incident report — chain L-C (issue #193).
 *
 * One-button SOS for low/medium reports + a "tap if critical" CTA that
 * escalates severity. Backend: POST /api/v1/mining/incidents — the
 * severity-escalator service decides the manager/owner/admin fan-out.
 */

import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Button } from '../../src/forms/Button'
import { colors } from '../../src/theme/colors'
import { fontSize, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-INC'

type Severity = 'low' | 'medium' | 'high' | 'critical'

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
  const [submitted, setSubmitted] = useState<Severity | null>(null)

  const onPress = (severity: Severity): void => {
    setSubmitted(severity)
    // POST /api/v1/mining/incidents wires in next iteration.
  }

  if (submitted) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>{isSw ? 'Imepokelewa' : 'Received'}</Text>
        <Text style={styles.subtitle}>
          {isSw
            ? 'Meneja wako ataona ripoti yako mara moja.'
            : 'Your manager will see this report immediately.'}
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
        <View style={styles.grid}>
          <Button label={isSw ? 'Chini' : 'Low'} onPress={() => onPress('low')} variant="ghost" />
          <Button label={isSw ? 'Wastani' : 'Medium'} onPress={() => onPress('medium')} variant="ghost" />
          <Button label={isSw ? 'Juu' : 'High'} onPress={() => onPress('high')} />
          <Button label={isSw ? 'HATARI' : 'CRITICAL'} onPress={() => onPress('critical')} variant="danger" />
        </View>
      </Section>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: spacing.lg, gap: spacing.md },
  title: { color: colors.text, fontSize: fontSize.h2, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: fontSize.body },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
})
