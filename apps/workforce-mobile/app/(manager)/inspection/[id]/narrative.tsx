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
 * Bilingual sw/en labels via `useI18n`. Errors render inline.
 */

import { useCallback, useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'

import { ScreenShell } from '../../../../src/components/ScreenShell'
import { Section } from '../../../../src/components/Section'
import { Button } from '../../../../src/forms/Button'
import { useI18n } from '../../../../src/i18n/useI18n'
import { colors } from '../../../../src/theme/colors'
import { fontSize, radius, spacing } from '../../../../src/theme/spacing'
import { request as apiRequest } from '../../../../src/api/client'
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

export default function InspectionNarrativeScreen(): JSX.Element {
  const params = useLocalSearchParams<{ id: string }>()
  const inspectionId = String(params.id ?? '')
  const { lang } = useI18n()
  const isSw = lang === 'sw'

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
      else setError('Failed to load narratives')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed')
    } finally {
      setLoading(false)
    }
  }, [inspectionId])

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
        setMessage(isSw ? 'Rasimu imezalishwa' : 'Narrative drafted')
        await refresh()
      } else {
        setError(json.error ?? 'generate failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'generate failed')
    } finally {
      setLoading(false)
    }
  }, [kind, notes, inspectionId, isSw, refresh])

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
          setMessage(isSw ? 'Imeidhinishwa' : 'Approved as manager')
          await refresh()
        } else {
          setError(json.error ?? 'approve failed')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'approve failed')
      } finally {
        setLoading(false)
      }
    },
    [inspectionId, isSw, refresh]
  )

  return (
    <ScreenShell screenId={SCREEN_ID}>
      <Section
        title={isSw ? 'Tengeneza ripoti' : 'Generate narrative'}
        hint={
          isSw
            ? 'Mr. Mwikila ataandaa rasimu ya ukaguzi kwa Kiswahili na Kiingereza.'
            : 'Mr. Mwikila will draft the inspection narrative in Swahili and English.'
        }
      >
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
          placeholder={
            isSw ? 'Maelezo ya ziada (hiari)' : 'Extra notes (optional)'
          }
          multiline
          style={styles.textArea}
        />
        <Button
          label={isSw ? 'Tengeneza rasimu' : 'Generate draft'}
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

      <Section
        title={isSw ? `Rasimu (${rows.length})` : `Drafts (${rows.length})`}
      >
        <ScrollView style={styles.list}>
          {rows.length === 0 ? (
            <Text style={styles.empty}>
              {isSw ? 'Bado hakuna rasimu' : 'No narratives yet.'}
            </Text>
          ) : null}
          {rows.map((row) => (
            <View key={row.id} style={styles.narrativeCard}>
              <Text style={styles.narrativeMeta}>
                {row.status} · {row.generatedAt.slice(0, 16).replace('T', ' ')}
              </Text>
              <Text style={styles.narrativeBody}>
                {(isSw ? row.draftMdSw : row.draftMdEn).slice(0, 480)}
                {(isSw ? row.draftMdSw : row.draftMdEn).length > 480
                  ? '…'
                  : ''}
              </Text>
              {row.status === 'draft' ? (
                <Button
                  label={isSw ? 'Idhinisha' : 'Approve as manager'}
                  onPress={() => void approve(row.id)}
                  disabled={loading}
                  style={styles.approveBtn}
                />
              ) : null}
              {row.status === 'manager_ok' ? (
                <Text style={styles.hint}>
                  {isSw
                    ? 'Inasubiri mmiliki kuthibitisha.'
                    : 'Awaiting owner sign.'}
                </Text>
              ) : null}
              {row.status === 'owner_signed' ? (
                <Text style={styles.hint}>
                  {isSw
                    ? 'Tayari kuwasilishwa kwa msimamizi.'
                    : 'Ready for regulator submission.'}
                </Text>
              ) : null}
              {row.status === 'submitted' ? (
                <Text style={styles.hint}>
                  {isSw ? 'Imewasilishwa' : 'Submitted'} ·{' '}
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
