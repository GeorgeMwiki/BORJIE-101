import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { BottomSheet } from './BottomSheet'
import { FormField } from './FormField'
import { PrimaryButton } from './PrimaryButton'
import { useToast } from './Toast'
import { useTranslation } from '@/hooks/useTranslation'
import { useDebouncedSubmit } from '@/hooks/useDebouncedSubmit'
import { raiseInquiry } from '@/api/inquiries'
import { raiseInquirySchema, type RaiseInquiryFormInput } from '@/schemas/inquiry'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'
import type { Listing } from '@/types/listing'

export interface AskSellerSheetProps {
  readonly visible: boolean
  readonly onClose: () => void
  readonly listing: Listing
}

/**
 * KI-006/KI-007 — the cross-tenant "Ask the seller" path. Mirrors
 * PlaceBidSheet, but raises an INQUIRY (the built cross-tenant mechanism)
 * instead of a bid. Shown in place of place-bid when the listing belongs to
 * a different tenant than the buyer (see isCrossTenantListing).
 */
export function AskSellerSheet({ visible, onClose, listing }: AskSellerSheetProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const toast = useToast()

  const { control, handleSubmit, reset, formState } = useForm<RaiseInquiryFormInput>({
    resolver: zodResolver(raiseInquirySchema),
    defaultValues: { message: '' }
  })

  useEffect(() => {
    if (visible) {
      reset({ message: '' })
    }
  }, [visible, reset])

  const submitMutation = useMutation({
    mutationFn: raiseInquiry,
    onSuccess: () => {
      toast.show(t('inquiry.sent'), 'success')
      onClose()
      router.push('/(tabs)/inquiries')
    },
    onError: () => {
      toast.show(t('inquiry.send_failed'), 'error')
    }
  })

  const onSubmitRaw = handleSubmit((values) => {
    submitMutation.mutate({
      listingId: listing.id,
      message: values.message
    })
  })
  // Belt-and-braces double-tap guard (mirrors PlaceBidSheet): the
  // isPending disable can lag a sub-microsecond double onPress.
  const onSubmit = useDebouncedSubmit(onSubmitRaw)

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('inquiry.title')}>
      <Text style={styles.listingTitle}>{listing.title}</Text>
      <Text style={styles.helper}>{t('inquiry.helper')}</Text>

      <Controller
        control={control}
        name="message"
        render={({ field, fieldState }) => (
          <FormField
            label={t('inquiry.message')}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            placeholder={t('inquiry.message_placeholder')}
            multiline
            numberOfLines={4}
            error={fieldState.error ? t('inquiry.message_invalid') : undefined}
          />
        )}
      />

      <View style={{ marginTop: spacing.lg }}>
        <PrimaryButton
          label={t('inquiry.submit')}
          onPress={onSubmit}
          disabled={submitMutation.isPending || !formState.isValid}
        />
      </View>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  listingTitle: { ...typography.heading, color: colors.ink, marginBottom: spacing.xs },
  helper: { ...typography.body, color: colors.inkMuted, marginBottom: spacing.lg }
})
