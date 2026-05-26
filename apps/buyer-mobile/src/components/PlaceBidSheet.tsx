import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { StyleSheet, Switch, Text, View } from 'react-native'
import { BottomSheet } from './BottomSheet'
import { FormField } from './FormField'
import { ChipGroup, type ChipOption } from './ChipGroup'
import { PrimaryButton } from './PrimaryButton'
import { useToast } from './Toast'
import { useTranslation } from '@/hooks/useTranslation'
import { placeBid, type PaymentTerms } from '@/api/marketplace'
import { isKycRequiredError } from '@/api/errors'
import { queryKeys } from '@/api/queryKeys'
import { parseBidPrice, placeBidSchema, type PlaceBidFormInput } from '@/schemas/bid'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'
import type { Listing } from '@/types/listing'

export interface PlaceBidSheetProps {
  readonly visible: boolean
  readonly onClose: () => void
  readonly listing: Listing
}

export function PlaceBidSheet({ visible, onClose, listing }: PlaceBidSheetProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const toast = useToast()
  const queryClient = useQueryClient()

  const { control, handleSubmit, reset, formState } = useForm<PlaceBidFormInput>({
    resolver: zodResolver(placeBidSchema),
    defaultValues: {
      bidPrice: String(listing.priceTzsPerKg),
      paymentTerms: 'instant',
      notes: '',
      termsAccepted: false
    }
  })

  useEffect(() => {
    if (visible) {
      reset({
        bidPrice: String(listing.priceTzsPerKg),
        paymentTerms: 'instant',
        notes: '',
        termsAccepted: false
      })
    }
  }, [visible, listing.priceTzsPerKg, reset])

  const submitMutation = useMutation({
    mutationFn: placeBid,
    onSuccess: async (bid) => {
      toast.show(t('bids.bid_submitted'), 'success')
      await queryClient.invalidateQueries({ queryKey: queryKeys.bids() })
      queryClient.setQueryData(queryKeys.bid(bid.id), bid)
      onClose()
      router.push(`/bids/${bid.id}`)
    },
    onError: (error) => {
      // Issue #20 — non-KYC'd users get a typed 403; route them through
      // the onboarding flow instead of surfacing a generic failure toast.
      if (isKycRequiredError(error)) {
        toast.show(t('bids.kyc_required'), 'info')
        onClose()
        router.push('/kyc')
        return
      }
      toast.show(t('bids.bid_failed'), 'error')
    }
  })

  const onSubmit = handleSubmit((values) => {
    submitMutation.mutate({
      listingId: listing.id,
      offerTzsPerKg: parseBidPrice(values.bidPrice),
      quantityKg: listing.quantityKg,
      paymentTerms: values.paymentTerms,
      notes: values.notes ?? '',
      termsAccepted: true
    })
  })

  const paymentOptions: readonly ChipOption<PaymentTerms>[] = [
    { value: 'instant', label: t('bids.payment_instant') },
    { value: '30d', label: t('bids.payment_30') },
    { value: '60d', label: t('bids.payment_60') }
  ]

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('bids.place_title')}>
      <Text style={styles.listingTitle}>{listing.title}</Text>

      <Controller
        control={control}
        name="bidPrice"
        render={({ field, fieldState }) => (
          <FormField
            label={t('bids.bid_price')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            keyboardType="decimal-pad"
            error={fieldState.error?.message ? t('common.retry') : undefined}
          />
        )}
      />

      <Text style={styles.label}>{t('bids.payment_terms')}</Text>
      <Controller
        control={control}
        name="paymentTerms"
        render={({ field }) => (
          <ChipGroup<PaymentTerms>
            options={paymentOptions}
            value={field.value}
            onChange={(next) => field.onChange(next ?? 'instant')}
            allowClear={false}
          />
        )}
      />

      <View style={{ height: spacing.md }} />

      <Controller
        control={control}
        name="notes"
        render={({ field }) => (
          <FormField
            label={t('bids.notes')}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            placeholder={t('bids.notes_placeholder')}
            multiline
            numberOfLines={3}
          />
        )}
      />

      <Controller
        control={control}
        name="termsAccepted"
        render={({ field, fieldState }) => (
          <View style={styles.termsRow}>
            <Switch
              value={Boolean(field.value)}
              onValueChange={(v) => field.onChange(v)}
              trackColor={{ true: colors.forest, false: colors.line }}
            />
            <Text style={[styles.termsLabel, fieldState.error ? styles.termsError : undefined]}>
              {t('bids.accept_terms')}
            </Text>
          </View>
        )}
      />

      <View style={{ marginTop: spacing.lg }}>
        <PrimaryButton
          label={t('bids.submit_bid')}
          onPress={onSubmit}
          disabled={submitMutation.isPending || !formState.isValid}
        />
      </View>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  listingTitle: { ...typography.heading, color: colors.ink, marginBottom: spacing.lg },
  label: { ...typography.caption, color: colors.inkMuted, marginBottom: spacing.xs },
  termsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  termsLabel: { ...typography.body, color: colors.inkSoft, flex: 1 },
  termsError: { color: colors.danger }
})
