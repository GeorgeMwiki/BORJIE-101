import { useEffect, useState } from 'react'
import { useRouter } from 'expo-router'
import { useMutation } from '@tanstack/react-query'
import { StyleSheet, Text, View } from 'react-native'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { Card } from '@/components/Card'
import { FormField } from '@/components/FormField'
import { PrimaryButton } from '@/components/PrimaryButton'
import { ChipGroup, type ChipOption } from '@/components/ChipGroup'
import { useToast } from '@/components/Toast'
import { useTranslation } from '@/hooks/useTranslation'
import { logout, setCurrentUser, useSession } from '@/auth/session'
import { updateProfile, type ProfileUpdate } from '@/api/buyers'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'
import type { LanguageCode } from '@/types/auth'

export default function ProfileIndex() {
  const router = useRouter()
  const { t } = useTranslation()
  const toast = useToast()
  const user = useSession()
  const [companyName, setCompanyName] = useState(user.companyName)
  const [phone, setPhone] = useState(user.phone)
  const [lang, setLang] = useState<LanguageCode>(user.preferredLang)

  useEffect(() => {
    setCompanyName(user.companyName)
    setPhone(user.phone)
    setLang(user.preferredLang)
  }, [user.companyName, user.phone, user.preferredLang])

  const saveMutation = useMutation({
    mutationFn: (input: ProfileUpdate) => updateProfile(input),
    onSuccess: (updated) => {
      setCurrentUser(updated)
      toast.show(t('profile.saved'), 'success')
    },
    onError: () => toast.show(t('profile.save_failed'), 'error')
  })

  const langOptions: readonly ChipOption<LanguageCode>[] = [
    { value: 'sw', label: 'Kiswahili' },
    { value: 'en', label: 'English' }
  ]

  async function handleLogout(): Promise<void> {
    await logout()
    router.replace('/auth/login')
  }

  return (
    <Screen>
      <SectionHeader title={t('profile.title')} subtitle={user.companyName} />

      <Card>
        <FormField label={t('profile.company')} value={companyName} onChangeText={setCompanyName} />
        <FormField label={t('profile.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />

        <Text style={styles.label}>{t('profile.language')}</Text>
        <ChipGroup<LanguageCode>
          options={langOptions}
          value={lang}
          onChange={(next) => setLang(next ?? 'sw')}
          allowClear={false}
        />

        <View style={{ marginTop: spacing.md }}>
          <PrimaryButton
            label={t('profile.save')}
            onPress={() =>
              saveMutation.mutate({
                companyName,
                phone,
                preferredLang: lang
              })
            }
            disabled={saveMutation.isPending}
          />
        </View>
      </Card>

      <Card onPress={() => router.push('/profile/notifications')}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('profile.notifications')}</Text>
          <Text style={styles.rowChevron}>›</Text>
        </View>
      </Card>

      <Card>
        <Text style={styles.cardTitle}>{t('profile.payment_methods')}</Text>
        <Text style={styles.meta}>M-Pesa · +255 712 *** 001</Text>
        <Text style={styles.meta}>NMB Bank · **** 4421</Text>
      </Card>

      <View style={{ marginTop: spacing.lg }}>
        <PrimaryButton label={t('profile.logout')} variant="ghost" onPress={handleLogout} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { ...typography.bodyStrong, color: colors.ink },
  rowChevron: { ...typography.title, color: colors.inkMuted },
  cardTitle: { ...typography.heading, color: colors.ink, marginBottom: spacing.sm },
  label: { ...typography.caption, color: colors.inkMuted, marginTop: spacing.sm, marginBottom: spacing.xs },
  meta: { ...typography.body, color: colors.inkSoft, marginTop: 2 }
})
