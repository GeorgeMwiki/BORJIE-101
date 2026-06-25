/**
 * Worker payslip screen — payroll chain L-B (issue #193), wired in WS-3.
 *
 * Binds to the REAL committed payroll line item for the signed-in worker via
 * GET /api/v1/mining/payslip/me (the worker-scoped read over payroll_line_items;
 * RLS + worker_user_id keep it to their own row). Bilingual field labels come
 * from the payroll calculator (carried in the response); money renders via
 * formatCurrency(amount, currencyCode) — no hard-coded currency. Single active
 * locale per the absolute sw/en toggle (no EN/SW mixing).
 */

import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { miningApi } from '../../src/api/client'
import { ApiError, isNetworkError } from '../../src/api/errors'
import { useI18n } from '../../src/i18n/useI18n'
import { pickStrings } from '../../src/i18n'
import {
  buildNet,
  buildPayslipRows,
  formatPeriod,
  type Lang,
  type PayslipData,
  type PayslipEnvelope,
} from '../../src/payslip/payslip.helpers'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-PAY'

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly offline: boolean }
  | { readonly kind: 'empty' }
  | { readonly kind: 'ready'; readonly data: PayslipData }

export default function PayslipScreen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <PayslipView />
      </ScreenShell>
    </RoleGuard>
  )
}

function PayslipView(): JSX.Element {
  const { lang, t } = useI18n()
  const copy = t.payslipScreen
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    let active = true
    setState({ kind: 'loading' })
    miningApi
      .get<PayslipEnvelope>('/payslip/me')
      .then((res) => {
        if (!active) return
        if (res.success && res.data) {
          setState({ kind: 'ready', data: res.data })
        } else {
          setState({ kind: 'empty' })
        }
      })
      .catch((err: unknown) => {
        if (!active) return
        setState({ kind: 'error', offline: isNetworkError(err) || err instanceof ApiError })
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.subtitle}>{copy.subtitle}</Text>
      <PayslipBody state={state} lang={lang} />
    </View>
  )
}

function PayslipBody({ state, lang }: { state: LoadState; lang: Lang }): JSX.Element {
  const copy = pickStrings(lang).payslipScreen

  if (state.kind === 'loading') {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={colors.gold} />
        <Text style={styles.muted}>{copy.loading}</Text>
      </View>
    )
  }

  if (state.kind === 'error') {
    return (
      <View style={styles.centre}>
        <Text style={styles.muted}>{copy.loadError}</Text>
      </View>
    )
  }

  if (state.kind === 'empty') {
    return (
      <Section title={copy.breakdown}>
        <Text style={styles.muted}>{copy.emptyBody}</Text>
      </Section>
    )
  }

  return <PayslipReady data={state.data} lang={lang} />
}

function PayslipReady({ data, lang }: { data: PayslipData; lang: Lang }): JSX.Element {
  const copy = pickStrings(lang).payslipScreen
  const rows = useMemo(() => buildPayslipRows(data, lang), [data, lang])
  const net = useMemo(() => buildNet(data, lang), [data, lang])

  return (
    <>
      <Text style={styles.period}>{copy.periodLabel + formatPeriod(data)}</Text>

      <Section title={copy.breakdown}>
        <View style={styles.table}>
          {rows.map((row) => (
            <View key={row.key} style={styles.row}>
              <Text style={styles.label}>{row.label}</Text>
              <Text style={styles.value}>{row.value}</Text>
            </View>
          ))}
        </View>
      </Section>

      <View style={styles.netCard}>
        <Text style={styles.netLabel}>{net.label}</Text>
        <Text style={styles.netValue}>{net.value}</Text>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: spacing.lg, gap: spacing.lg },
  title: { color: colors.text, fontSize: fontSize.h2, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: fontSize.body },
  period: { color: colors.textMuted, fontSize: fontSize.caption },
  centre: { paddingVertical: spacing.xl, alignItems: 'center', gap: spacing.sm },
  muted: { color: colors.textMuted, fontSize: fontSize.body, textAlign: 'center' },
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
