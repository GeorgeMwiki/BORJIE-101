/**
 * R11 — buyer creates a Request for Bids.
 *
 * Form-driven screen mounted at /rfb/create. POSTs to
 * /api/v1/marketplace/rfb. Bilingual sw/en throughout via the
 * shared useTranslation hook.
 *
 * Form fields (mirrors the gateway zod schema):
 *   - mineralKind (picker)
 *   - tonnageMin (number)
 *   - unitPriceTzs (number)
 *   - deliveryBy (YYYY-MM-DD)
 *   - radiusKm (slider — 50-1000)
 *   - notes (optional)
 *
 * Submit is debounced via useDebouncedSubmit so double-taps cannot
 * post two RFBs.
 */
import { useState } from 'react'
import { useRouter } from 'expo-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { StyleSheet, Text, TextInput } from 'react-native'

import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { Card } from '@/components/Card'
import { ChipGroup, type ChipOption } from '@/components/ChipGroup'
import { PrimaryButton } from '@/components/PrimaryButton'
import { useToast } from '@/components/Toast'
import { useTranslation } from '@/hooks/useTranslation'
import { useDebouncedSubmit } from '@/hooks/useDebouncedSubmit'

import { createRfb, RFB_MINERAL_KINDS, type RfbMineralKind } from '@/api/rfb'
import { queryKeys } from '@/api/queryKeys'

import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'

const DEFAULT_RADIUS_KM = 200

interface FormState {
  mineralKind: RfbMineralKind
  tonnageMin: string
  unitPriceTzs: string
  deliveryBy: string
  radiusKm: string
  notes: string
}

const INITIAL_STATE: FormState = {
  mineralKind: 'gold',
  tonnageMin: '',
  unitPriceTzs: '',
  deliveryBy: '',
  radiusKm: String(DEFAULT_RADIUS_KM),
  notes: ''
}

function parsePositiveNumber(input: string): number | null {
  const n = Number(input)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

// The mineral picker reuses the shared ChipGroup (Pressable + a11y). The
// raw enum key is the label, matching the gateway vocabulary the buyer
// already sees on the listings surface.
const MINERAL_OPTIONS: readonly ChipOption<RfbMineralKind>[] = RFB_MINERAL_KINDS.map(
  (kind) => ({ value: kind, label: kind })
)

export default function RfbCreate() {
  const router = useRouter()
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(INITIAL_STATE)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: createRfb,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.rfbsMine() })
      toast.show(t('rfb.submit_success'), 'success')
      router.replace('/rfb')
    },
    onError: () => {
      toast.show(t('rfb.submit_failed'), 'error')
    }
  })

  const submit = useDebouncedSubmit(() => {
    setError(null)
    const tonnage = parsePositiveNumber(form.tonnageMin)
    if (tonnage == null) {
      setError(t('rfb.tonnage_required_invalid'))
      return
    }
    const unitPrice = parsePositiveNumber(form.unitPriceTzs)
    if (unitPrice == null) {
      setError(t('rfb.unit_price_invalid'))
      return
    }
    // Required-by must parse + be in the future. The gateway re-checks.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.deliveryBy)) {
      setError(t('rfb.delivery_in_past'))
      return
    }
    const dueMs = Date.parse(`${form.deliveryBy}T00:00:00Z`)
    if (Number.isNaN(dueMs) || dueMs < Date.now()) {
      setError(t('rfb.delivery_in_past'))
      return
    }
    const radiusKm = parsePositiveNumber(form.radiusKm) ?? DEFAULT_RADIUS_KM
    const notes = form.notes.trim()
    mutation.mutate({
      mineralKind: form.mineralKind,
      tonnageMin: tonnage,
      unitPriceTzs: unitPrice,
      deliveryBy: form.deliveryBy,
      radiusKm: Math.min(5000, Math.round(radiusKm)),
      ...(notes.length > 0 ? { notes } : {})
    })
  })

  return (
    <Screen>
      <SectionHeader title={t('rfb.create_title')} subtitle={t('rfb.subtitle')} />
      <Card>
        <Text style={styles.label}>{t('rfb.mineral_label')}</Text>
        <ChipGroup<RfbMineralKind>
          options={MINERAL_OPTIONS}
          value={form.mineralKind}
          onChange={(next) =>
            setForm((prev) => ({ ...prev, mineralKind: next ?? prev.mineralKind }))
          }
          allowClear={false}
        />

        <Text style={styles.label}>{t('rfb.tonnage_min_label')}</Text>
        <TextInput
          style={styles.input}
          value={form.tonnageMin}
          onChangeText={(v) => setForm((prev) => ({ ...prev, tonnageMin: v }))}
          keyboardType="numeric"
          placeholder="0"
          placeholderTextColor={colors.ink + '60'}
          testID="rfb-tonnage-min-input"
        />

        <Text style={styles.label}>{t('rfb.unit_price_label')}</Text>
        <TextInput
          style={styles.input}
          value={form.unitPriceTzs}
          onChangeText={(v) => setForm((prev) => ({ ...prev, unitPriceTzs: v }))}
          keyboardType="numeric"
          placeholder="0"
          placeholderTextColor={colors.ink + '60'}
          testID="rfb-unit-price-input"
        />

        <Text style={styles.label}>{t('rfb.delivery_by_label')}</Text>
        <TextInput
          style={styles.input}
          value={form.deliveryBy}
          onChangeText={(v) => setForm((prev) => ({ ...prev, deliveryBy: v }))}
          placeholder={t('rfb.delivery_by_placeholder')}
          placeholderTextColor={colors.ink + '60'}
          autoCapitalize="none"
          autoCorrect={false}
          testID="rfb-delivery-by-input"
        />

        <Text style={styles.label}>
          {t('rfb.radius_label')} ({t('rfb.radius_value', { km: form.radiusKm })})
        </Text>
        <TextInput
          style={styles.input}
          value={form.radiusKm}
          onChangeText={(v) => setForm((prev) => ({ ...prev, radiusKm: v }))}
          keyboardType="numeric"
          testID="rfb-radius-input"
        />

        <Text style={styles.label}>{t('rfb.notes_label')}</Text>
        <TextInput
          style={[styles.input, styles.notes]}
          value={form.notes}
          onChangeText={(v) => setForm((prev) => ({ ...prev, notes: v }))}
          multiline
          placeholderTextColor={colors.ink + '60'}
          testID="rfb-notes-input"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton
          label={t('rfb.submit')}
          onPress={submit}
          busy={mutation.isPending}
          testID="rfb-submit-button"
        />
      </Card>
    </Screen>
  )
}

const styles = StyleSheet.create({
  label: {
    ...typography.label,
    color: colors.ink,
    marginTop: spacing.md,
    marginBottom: spacing.xs
  },
  input: {
    backgroundColor: colors.bone,
    borderColor: colors.steel,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.ink,
    fontSize: 16
  },
  notes: {
    minHeight: 80,
    textAlignVertical: 'top'
  },
  error: {
    color: colors.danger,
    marginTop: spacing.sm,
    marginBottom: spacing.xs
  }
})
