import { useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { PrimaryButton } from '@/components/PrimaryButton'
import { useToast } from '@/components/Toast'
import { useTranslation } from '@/hooks/useTranslation'
import { pickIdImage } from '@/kyc/pickers'
import type { NidaValues } from '@/schemas/kyc'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'

export interface NidaStepProps {
  readonly initial: NidaValues
  readonly onNext: (values: NidaValues) => void
  readonly onBack: () => void
}

export function NidaStep({ initial, onNext, onBack }: NidaStepProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const [front, setFront] = useState(initial.frontImageUri)
  const [back, setBack] = useState(initial.backImageUri)

  async function handlePick(side: 'front' | 'back'): Promise<void> {
    const result = await pickIdImage()
    if (!result.ok) {
      if (result.reason === 'denied') {
        toast.show(t('kyc.image_picker_denied'), 'error')
      }
      return
    }
    if (side === 'front') {
      setFront(result.uri)
    } else {
      setBack(result.uri)
    }
  }

  const canContinue = front.length > 0 && back.length > 0

  return (
    <View>
      <PickerTile label={t('kyc.nida_front')} uri={front} onPress={() => handlePick('front')} ctaLabel={t(front ? 'kyc.retake' : 'kyc.capture')} />
      <PickerTile label={t('kyc.nida_back')} uri={back} onPress={() => handlePick('back')} ctaLabel={t(back ? 'kyc.retake' : 'kyc.capture')} />

      <View style={styles.actions}>
        <View style={styles.flex}>
          <PrimaryButton label={t('kyc.back')} variant="ghost" onPress={onBack} />
        </View>
        <View style={styles.spacer} />
        <View style={styles.flex}>
          <PrimaryButton
            label={t('kyc.next')}
            onPress={() => onNext({ frontImageUri: front, backImageUri: back })}
            disabled={!canContinue}
          />
        </View>
      </View>
    </View>
  )
}

interface PickerTileProps {
  readonly label: string
  readonly uri: string
  readonly onPress: () => void
  readonly ctaLabel: string
}

function PickerTile({ label, uri, onPress, ctaLabel }: PickerTileProps) {
  return (
    <Pressable onPress={onPress} style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      {uri ? (
        <Image source={{ uri }} style={styles.preview} />
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderLabel}>{label}</Text>
        </View>
      )}
      <Text style={styles.cta}>{ctaLabel}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  tile: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    padding: spacing.md,
    marginBottom: spacing.md
  },
  tileLabel: { ...typography.bodyStrong, color: colors.ink, marginBottom: spacing.sm },
  preview: { width: '100%', height: 160, borderRadius: radius.md, backgroundColor: colors.sand },
  placeholder: {
    width: '100%',
    height: 160,
    borderRadius: radius.md,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center'
  },
  placeholderLabel: { ...typography.caption, color: colors.inkMuted },
  cta: { ...typography.bodyStrong, color: colors.forest, marginTop: spacing.sm },
  actions: { flexDirection: 'row', marginTop: spacing.md },
  flex: { flex: 1 },
  spacer: { width: spacing.md }
})
