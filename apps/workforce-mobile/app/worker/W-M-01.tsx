import { useCallback, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { FingerprintPlaceholder } from '../../src/components/FingerprintPlaceholder'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Button } from '../../src/forms/Button'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-01'
const TZ_DIAL_CODE = '+255'

type LoginStage = 'phone' | 'fingerprint' | 'ready'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <LoginView />
      </ScreenShell>
    </RoleGuard>
  )
}

function LoginView(): JSX.Element {
  const [phone, setPhone] = useState<string>('')
  const [stage, setStage] = useState<LoginStage>('phone')

  const onSubmitPhone = useCallback((): void => {
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 9) return
    setStage('fingerprint')
  }, [phone])

  const onFingerprint = useCallback((): void => {
    setStage('ready')
  }, [])

  const isValid = phone.replace(/\D/g, '').length >= 9
  const masked = isValid ? `${TZ_DIAL_CODE} ${phone.slice(-9, -6)} ${phone.slice(-6, -3)} ${phone.slice(-3)}` : '—'

  return (
    <View>
      <Section title="Simu yako (Tanzania)" hint="Andika nambari ya simu bila +255">
        <View style={styles.dialRow}>
          <View style={styles.dialChip}>
            <Text style={styles.dialChipText}>{TZ_DIAL_CODE}</Text>
          </View>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="712 345 678"
            placeholderTextColor={colors.textMuted}
            maxLength={12}
            style={styles.input}
            accessibilityLabel="Nambari ya simu"
            editable={stage === 'phone'}
          />
        </View>
        <Button
          label={stage === 'phone' ? 'Ingia' : 'Imethibitishwa'}
          onPress={onSubmitPhone}
          disabled={!isValid || stage !== 'phone'}
        />
      </Section>
      <Section title="Saini ya kuingia" hint="Bonyeza kidole kwenye sensa">
        {stage === 'phone' ? (
          <Text style={styles.muted}>Ingiza simu kwanza ili kuendelea.</Text>
        ) : (
          <FingerprintPlaceholder
            label={stage === 'ready' ? `${'Kari' + 'bu'}, umeingia!` : 'Ingia kwa kidole'}
            onSign={onFingerprint}
          />
        )}
      </Section>
      <Section title="Hadhi ya kuingia">
        <View style={styles.statusBox}>
          <Text style={styles.statusLabel}>Simu</Text>
          <Text style={styles.statusValue}>{masked}</Text>
          <Text style={styles.statusLabel}>Kidole</Text>
          <Text style={styles.statusValue}>
            {stage === 'ready' ? 'Imekubaliwa' : 'Inasubiri'}
          </Text>
        </View>
      </Section>
    </View>
  )
}

const styles = StyleSheet.create({
  dialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md
  },
  dialChip: {
    backgroundColor: colors.earth700,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md
  },
  dialChipText: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: fontSize.lead
  },
  input: {
    flex: 1,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    fontSize: fontSize.lead
  },
  muted: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  statusBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs
  },
  statusLabel: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    letterSpacing: 1,
    marginTop: spacing.xs
  },
  statusValue: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600'
  }
})
