import { useState } from 'react'
import { useRouter } from 'expo-router'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { Screen } from '@/components/Screen'
import { PrimaryButton } from '@/components/PrimaryButton'
import { useTranslation } from '@/hooks/useTranslation'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'

type Stage = 'phone' | 'otp'

export default function AuthLogin() {
  const router = useRouter()
  const { t } = useTranslation()
  const [stage, setStage] = useState<Stage>('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={styles.brand}>{t('app.name')}</Text>
        <Text style={styles.slogan}>{t('app.slogan')}</Text>
      </View>

      <Text style={styles.title}>{t('auth.login_title')}</Text>

      {stage === 'phone' ? (
        <View style={styles.field}>
          <Text style={styles.label}>{t('auth.phone_label')}</Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder={t('auth.phone_placeholder')}
            placeholderTextColor={colors.inkMuted}
            keyboardType="phone-pad"
            style={styles.input}
          />
          <View style={{ height: spacing.lg }} />
          <PrimaryButton
            label={t('auth.send_otp')}
            onPress={() => setStage('otp')}
            disabled={phone.trim().length < 9}
          />
        </View>
      ) : (
        <View style={styles.field}>
          <Text style={styles.label}>{t('auth.otp_label')}</Text>
          <TextInput
            value={otp}
            onChangeText={setOtp}
            placeholder="123456"
            placeholderTextColor={colors.inkMuted}
            keyboardType="number-pad"
            maxLength={6}
            style={styles.input}
          />
          <View style={{ height: spacing.lg }} />
          <PrimaryButton
            label={t('auth.verify')}
            onPress={() => router.replace('/marketplace')}
            disabled={otp.length < 4}
          />
        </View>
      )}

      <Text style={styles.terms}>{t('auth.terms')}</Text>
    </Screen>
  )
}

const styles = StyleSheet.create({
  hero: { marginBottom: spacing.xxl, alignItems: 'center' },
  brand: { ...typography.display, color: colors.forest },
  slogan: { ...typography.body, color: colors.copper, marginTop: spacing.xs },
  title: { ...typography.title, color: colors.ink, marginBottom: spacing.lg },
  field: { marginBottom: spacing.lg },
  label: { ...typography.caption, color: colors.inkMuted, marginBottom: spacing.xs },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
    color: colors.ink,
    ...typography.body
  },
  terms: { ...typography.caption, color: colors.inkMuted, marginTop: spacing.xl, textAlign: 'center' }
})
