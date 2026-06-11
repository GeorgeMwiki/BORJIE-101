/**
 * Worker leave-request screen — WS-3 workforce wires.
 *
 * Submits a real leave request to POST /api/v1/mining/leave-requests and lists
 * the worker's own requests (GET /mine) with bilingual status pills. Mirrors
 * the grievance/incident worker flow. A manager approves elsewhere (single
 * sign-off, NO four-eye) which flips the status the worker sees here. Single
 * active locale per the absolute sw/en toggle (no EN/SW mixing).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Button } from '../../src/forms/Button'
import { Field } from '../../src/forms/Field'
import { Dropdown } from '../../src/forms/Dropdown'
import { miningApi } from '../../src/api/client'
import { useI18n } from '../../src/i18n/useI18n'
import {
  buildSubmitPayload,
  categoryLabel,
  LEAVE_CATEGORIES,
  statusLabel,
  statusTone,
  type Lang,
  type LeaveCategory,
  type LeaveRequestRow,
} from '../../src/leave/leave.helpers'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-LEAVE'

interface ListEnvelope {
  readonly success: boolean
  readonly data: ReadonlyArray<LeaveRequestRow>
}

interface SubmitEnvelope {
  readonly success: boolean
  readonly data?: LeaveRequestRow
}

export default function LeaveScreen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <LeaveView />
      </ScreenShell>
    </RoleGuard>
  )
}

function LeaveView(): JSX.Element {
  const { lang } = useI18n()
  const isSw = lang === 'sw'

  const [category, setCategory] = useState<LeaveCategory>('annual')
  const [startOn, setStartOn] = useState('')
  const [endOn, setEndOn] = useState('')
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [rows, setRows] = useState<ReadonlyArray<LeaveRequestRow> | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const categoryOptions = useMemo(
    () =>
      LEAVE_CATEGORIES.map((c) => ({
        value: c,
        label: categoryLabel(c, lang),
      })),
    [lang],
  )

  const refresh = useCallback(async () => {
    try {
      const res = await miningApi.get<ListEnvelope>('/leave-requests/mine')
      if (res.success) {
        setRows(res.data)
        setListError(null)
      } else {
        // Server responded but flagged failure — surface the error rather
        // than silently rendering the empty-state copy as if there are no
        // requests (which could prompt a duplicate submission).
        setListError(isSw ? 'Imeshindwa kupakua maombi.' : 'Could not load requests.')
      }
    } catch {
      // Network / 5xx — surface an error state rather than showing
      // "no requests yet" which is indistinguishable from a real empty list.
      setListError(isSw ? 'Imeshindwa kupakua maombi.' : 'Could not load requests.')
    }
  }, [isSw])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onSubmit = useCallback(async () => {
    const validated = buildSubmitPayload({ category, startOn, endOn, reason }, lang)
    if (!validated.ok) {
      setFormError(validated.error)
      return
    }
    setFormError(null)
    setSubmitting(true)
    try {
      const res = await miningApi.post<SubmitEnvelope>('/leave-requests', validated.payload)
      if (res.success) {
        setStartOn('')
        setEndOn('')
        setReason('')
        setCategory('annual')
        await refresh()
      } else {
        setFormError(isSw ? 'Imeshindwa kutuma ombi.' : 'Could not submit the request.')
      }
    } catch {
      setFormError(isSw ? 'Imeshindwa kutuma ombi.' : 'Could not submit the request.')
    } finally {
      setSubmitting(false)
    }
  }, [category, startOn, endOn, reason, lang, isSw, refresh])

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{isSw ? 'Omba likizo' : 'Request leave'}</Text>
      <Text style={styles.subtitle}>
        {isSw
          ? 'Jaza ombi lako. Meneja wako atathibitisha au kukataa.'
          : 'Fill in your request. Your manager will approve or reject it.'}
      </Text>

      <Section title={isSw ? 'Ombi jipya' : 'New request'}>
        <Dropdown<LeaveCategory>
          label={isSw ? 'Aina ya likizo' : 'Leave type'}
          value={category}
          onChange={setCategory}
          options={categoryOptions}
        />
        <Field
          label={isSw ? 'Tarehe ya kuanza' : 'Start date'}
          value={startOn}
          onChangeText={setStartOn}
          placeholder="2026-06-10"
          autoCapitalize="none"
        />
        <Field
          label={isSw ? 'Tarehe ya mwisho' : 'End date'}
          value={endOn}
          onChangeText={setEndOn}
          placeholder="2026-06-12"
          autoCapitalize="none"
        />
        <Field
          label={isSw ? 'Sababu (hiari)' : 'Reason (optional)'}
          value={reason}
          onChangeText={setReason}
          multiline
          autoCapitalize="sentences"
        />
        {formError ? <Text style={styles.error}>{formError}</Text> : null}
        <Button
          label={submitting ? (isSw ? 'Inatuma…' : 'Submitting…') : isSw ? 'Tuma ombi' : 'Submit request'}
          onPress={() => void onSubmit()}
          disabled={submitting}
        />
      </Section>

      <Section title={isSw ? 'Maombi yangu' : 'My requests'}>
        <LeaveList rows={rows} listError={listError} lang={lang} />
      </Section>
    </View>
  )
}

function LeaveList({
  rows,
  listError,
  lang,
}: {
  rows: ReadonlyArray<LeaveRequestRow> | null
  listError: string | null
  lang: Lang
}): JSX.Element {
  const isSw = lang === 'sw'

  if (listError) {
    return <Text style={styles.muted}>{listError}</Text>
  }
  if (rows === null) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={colors.gold} />
      </View>
    )
  }
  if (rows.length === 0) {
    return (
      <Text style={styles.muted}>
        {isSw ? 'Hujatuma ombi lolote bado.' : 'You have not submitted any requests yet.'}
      </Text>
    )
  }

  return (
    <View style={styles.list}>
      {rows.map((row) => (
        <View key={row.id} style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>{categoryLabel(row.category, lang)}</Text>
            <StatusPill status={row.status} lang={lang} />
          </View>
          <Text style={styles.cardDates}>
            {row.startOn} → {row.endOn}
          </Text>
          {row.reason ? <Text style={styles.cardReason}>{row.reason}</Text> : null}
          {row.decisionNote ? (
            <Text style={styles.cardNote}>
              {(isSw ? 'Meneja: ' : 'Manager: ') + row.decisionNote}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  )
}

function StatusPill({
  status,
  lang,
}: {
  status: LeaveRequestRow['status']
  lang: Lang
}): JSX.Element {
  const tone = statusTone(status)
  const bg =
    tone === 'success' ? colors.success : tone === 'danger' ? colors.danger : colors.goldDark
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={styles.pillText}>{statusLabel(status, lang)}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: spacing.lg, gap: spacing.lg },
  title: { color: colors.text, fontSize: fontSize.h2, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: fontSize.body },
  error: { color: colors.danger, fontSize: fontSize.caption },
  muted: { color: colors.textMuted, fontSize: fontSize.body },
  centre: { paddingVertical: spacing.lg, alignItems: 'center' },
  list: { gap: spacing.sm },
  card: {
    backgroundColor: colors.earth700,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: { color: colors.text, fontSize: fontSize.body, fontWeight: '700' },
  cardDates: { color: colors.textMuted, fontSize: fontSize.caption },
  cardReason: { color: colors.text, fontSize: fontSize.body },
  cardNote: { color: colors.textMuted, fontSize: fontSize.caption, fontStyle: 'italic' },
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  pillText: { color: colors.textInverse, fontSize: fontSize.caption, fontWeight: '700' },
})
