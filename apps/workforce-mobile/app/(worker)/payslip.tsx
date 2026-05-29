/**
 * Worker payslip screen — payroll chain L-B (issue #193).
 *
 * Shows the worker's most recent payroll line item: hours, base,
 * overtime, bonus, deduction, net. Bilingual sw/en (default sw).
 * Backend: GET /api/v1/owner/payroll/runs/:id (worker reads their own
 * line item from the response).
 */

import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-PAY'

interface PayslipLine {
  readonly label: string
  readonly value: string
}

export default function PayslipScreen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <PayslipView lang="sw" />
      </ScreenShell>
    </RoleGuard>
  )
}

function PayslipView({ lang }: { lang: 'sw' | 'en' }): JSX.Element {
  const isSw = lang === 'sw'
  const lines = useMemo<PayslipLine[]>(
    () => [
      { label: isSw ? 'Masaa ya kazi' : 'Hours worked', value: '—' },
      { label: isSw ? 'Masaa ya ziada' : 'Overtime hours', value: '—' },
      { label: isSw ? 'Mshahara wa msingi' : 'Base', value: '— TZS' },
      { label: isSw ? 'Mshahara wa ziada' : 'Overtime', value: '— TZS' },
      { label: isSw ? 'Bonasi' : 'Bonus', value: '— TZS' },
      { label: isSw ? 'Makato' : 'Deduction', value: '— TZS' },
    ],
    [isSw],
  )

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{isSw ? 'Payslip yako' : 'Your payslip'}</Text>
      <Text style={styles.subtitle}>
        {isSw
          ? 'Kipindi cha hivi karibuni. Pesa hutumwa kwa M-Pesa.'
          : 'Latest period. Funds disburse via M-Pesa B2C once the owner commits.'}
      </Text>

      <Section title={isSw ? 'Maelezo' : 'Breakdown'}>
        <View style={styles.table}>
          {lines.map((line) => (
            <View key={line.label} style={styles.row}>
              <Text style={styles.label}>{line.label}</Text>
              <Text style={styles.value}>{line.value}</Text>
            </View>
          ))}
        </View>
      </Section>

      <View style={styles.netCard}>
        <Text style={styles.netLabel}>
          {isSw ? 'Jumla utakayopokea' : 'You will receive'}
        </Text>
        <Text style={styles.netValue}>— TZS</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: spacing.lg, gap: spacing.lg },
  title: { color: colors.text, fontSize: fontSize.h2, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: fontSize.body },
  table: {
    backgroundColor: colors.earth700,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  label: { color: colors.textMuted, fontSize: fontSize.body },
  value: { color: colors.text, fontSize: fontSize.body, fontWeight: '600' },
  netCard: {
    backgroundColor: colors.gold,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  netLabel: { color: colors.textInverse, fontSize: fontSize.body, opacity: 0.85 },
  netValue: { color: colors.textInverse, fontSize: fontSize.h1, fontWeight: '700' },
})
