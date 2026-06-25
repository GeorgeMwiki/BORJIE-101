/**
 * Manager inspection narrative — issue #194 chain C-C.
 *
 * Screen-id: M-INS-01. Reached from the manager's inspection summary
 * via tap. Three actions:
 *
 *   1. Generate narrative — POST /api/v1/compliance/inspections/:id/generate-narrative
 *   2. Approve as manager — POST /api/v1/compliance/inspections/:id/narratives/:narrativeId/manager-approve
 *   3. Submit to regulator — POST /api/v1/compliance/inspections/:id/narratives/:narrativeId/submit-to-regulator
 *
 * Single-language-per-active-locale copy via `useI18n` (the `narrative`
 * namespace — no inline `isSw ? '…' : '…'` ternaries). Gateway errors localize
 * by code through `localizeApiError` from `@borjie/error-catalog` — never the
 * raw English `err.message` (which under `sw` is language mixing). Errors render
 * inline.
 */

import { useCallback, useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { localizeApiError } from '@borjie/error-catalog'

import { ScreenShell } from '../../../../src/components/ScreenShell'
import { Section } from '../../../../src/components/Section'
import { RoleGuard } from '../../../../src/components/RoleGuard'
import { Button } from '../../../../src/forms/Button'
import { useI18n } from '../../../../src/i18n/useI18n'
import { narrativeStatusLabel } from '../../../../src/i18n/enumLabels'
import { colors } from '../../../../src/theme/colors'
import { fontSize, radius, spacing } from '../../../../src/theme/spacing'
import { request as apiRequest } from '../../../../src/api/client'
import { ApiError } from '../../../../src/api/errors'
import { API_BASE_URL } from '../../../../src/api/config'

const API_V1 = `${API_BASE_URL}/api/v1`

const SCREEN_ID = 'M-INS-01'

type NarrativeKind = 'environmental' | 'safety' | 'financial' | 'other'
type Status =
  | 'draft'
  | 'manager_ok'
  | 'owner_signed'
  | 'submitted'
  | 'delivered'
  | 'superseded'

interface NarrativeRow {
  readonly id: string
  readonly inspectionId: string
  readonly inspectionKind: NarrativeKind
  readonly status: Status
  readonly draftMdSw: string
  readonly draftMdEn: string
  readonly generatedAt: string
  readonly managerOkAt: string | null
  readonly ownerSignedAt: string | null
  readonly regulatorSentAt: string | null
}

/**
 * Active-locale draft body (a data-field pick, not bilingual inline copy). The
 * row carries both locales pre-authored by the brain; we render only the active
 * one — no cross-language fallback.
 */
function draftBody(row: NarrativeRow, lang: 'sw' | 'en'): string {
  return lang === 'sw' ? row.draftMdSw : row.draftMdEn
}

export default function InspectionNarrativeScreen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <InspectionNarrativeView />
    </RoleGuard>
  )
}

function InspectionNarrativeView(): JSX.Element {
  const params = useLocalSearchParams<{ id: string }>()
  const inspectionId = String(params.id ?? '')
  const { lang, t } = useI18n()
  const copy = t.narrative

  const [rows, setRows] = useState<readonly NarrativeRow[]>([])
  const [notes, setNotes] = useState<string>('')
  const [kind, setKind] = useState<NarrativeKind>('safety')
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const json = await apiRequest<{
        success: boolean
        data: readonly NarrativeRow[]
      }>(`${API_V1}/compliance/inspections/${inspectionId}/narratives`)
      if (json.success) setRows(json.data)
      else setError(copy.loadFailed)
    } catch (err) {
      setError(
        localizeApiError(err instanceof ApiError ? err.code : undefined, lang),
      )
    } finally {
      setLoading(false)
    }
  }, [inspectionId, copy.loadFailed, lang])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const generate = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      const body: Record<string, string> = { inspectionKind: kind }
      if (notes.trim()) body.notes = notes.trim()
      const json = await apiRequest<{ success: boolean; error?: string }>(
        `${API_V1}/compliance/inspections/${inspectionId}/generate-narrative`,
        { method: 'POST', body }
      )
      if (json.success) {
        setMessage(copy.drafted)
        await refresh()
      } else {
        setError(copy.generateFailed)
      }
    } catch (err) {
      setError(
        localizeApiError(err instanceof ApiError ? err.code : undefined, lang),
      )
    } finally {
      setLoading(false)
    }
  }, [kind, notes, inspectionId, copy.drafted, copy.generateFailed, lang, refresh])

  const approve = useCallback(
    async (narrativeId: string): Promise<void> => {
      setLoading(true)
      setError(null)
      try {
        const json = await apiRequest<{ success: boolean; error?: string }>(
          `${API_V1}/compliance/inspections/${inspectionId}/narratives/${narrativeId}/manager-approve`,
          { method: 'POST', body: {} }
        )
        if (json.success) {
          setMessage(copy.approved)
          await refresh()
        } else {
          setError(copy.approveFailed)
        }
      } catch (err) {
        setError(
          localizeApiError(err instanceof ApiError ? err.code : undefined, lang),
        )
      } finally {
        setLoading(false)
      }
    },
    [inspectionId, copy.approved, copy.approveFailed, lang, refresh]
  )

  return (
    <ScreenShell screenId={SCREEN_ID}>
      <Section title={copy.generateTitle} hint={copy.generateHint}>
        <View style={styles.formRow}>
          {(['safety', 'environmental', 'financial', 'other'] as const).map(
            (k) => (
              <Button
                key={k}
                label={k}
                variant={kind === k ? 'primary' : 'ghost'}
                onPress={() => setKind(k)}
                style={styles.kindBtn}
              />
            )
          )}
        </View>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder={copy.notesPlaceholder}
          multiline
          style={styles.textArea}
        />
        <Button
          label={copy.generateCta}
          onPress={() => void generate()}
          disabled={loading}
        />
      </Section>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
      {message ? (
        <View style={styles.successBox}>
          <Text style={styles.successText}>{message}</Text>
        </View>
      ) : null}

      <Section title={copy.draftsTitle.replace('{{count}}', String(rows.length))}>
        <ScrollView style={styles.list}>
          {rows.length === 0 ? (
            <Text style={styles.empty}>{copy.empty}</Text>
          ) : null}
          {rows.map((row) => (
            <View key={row.id} style={styles.narrativeCard}>
              <Text style={styles.narrativeMeta}>
                {narrativeStatusLabel(row.status, t)} ·{' '}
                {row.generatedAt.slice(0, 16).replace('T', ' ')}
              </Text>
              <Text style={styles.narrativeBody}>
                {draftBody(row, lang).slice(0, 480)}
                {draftBody(row, lang).length > 480 ? '…' : ''}
              </Text>
              {row.status === 'draft' ? (
                <Button
                  label={copy.approveCta}
                  onPress={() => void approve(row.id)}
                  disabled={loading}
                  style={styles.approveBtn}
                />
              ) : null}
              {row.status === 'manager_ok' ? (
                <Text style={styles.hint}>{copy.awaitingOwner}</Text>
              ) : null}
              {row.status === 'owner_signed' ? (
                <Text style={styles.hint}>{copy.readyForRegulator}</Text>
              ) : null}
              {row.status === 'submitted' ? (
                <Text style={styles.hint}>
                  {copy.submitted} ·{' '}
                  {row.regulatorSentAt?.slice(0, 16).replace('T', ' ') ?? ''}
                </Text>
              ) : null}
            </View>
          ))}
        </ScrollView>
      </Section>
    </ScreenShell>
  )
}

const styles = StyleSheet.create({
  formRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  kindBtn: {
    flexBasis: '48%',
  },
  textArea: {
    minHeight: 80,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    fontSize: fontSize.body,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  errorBox: {
    marginVertical: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: '#fde8e8',
  },
  errorText: { color: '#b91c1c', fontSize: fontSize.body },
  successBox: {
    marginVertical: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: '#d1fae5',
  },
  successText: { color: '#065f46', fontSize: fontSize.body },
  list: {
    maxHeight: 480,
  },
  empty: {
    color: colors.textMuted,
    fontStyle: 'italic',
    fontSize: fontSize.body,
  },
  narrativeCard: {
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  narrativeMeta: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  narrativeBody: {
    fontSize: fontSize.body,
    color: colors.text,
    lineHeight: 22,
  },
  approveBtn: {
    marginTop: spacing.sm,
  },
  hint: {
    marginTop: spacing.sm,
    fontSize: fontSize.caption,
    color: colors.textMuted,
  },
})
