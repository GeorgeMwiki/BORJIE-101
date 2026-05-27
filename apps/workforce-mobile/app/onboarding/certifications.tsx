import { useEffect, useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { Button } from '../../src/forms/Button'
import { WizardShell } from '../../src/onboarding/WizardShell'
import { useOnboardingDraft } from '../../src/onboarding/state'
import { recommendCertifications } from '../../src/onboarding/intelligence'
import { CERTIFICATIONS, type Certification } from '../../src/onboarding/certifications'
import { pickStrings } from '../../src/i18n'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

/**
 * Multi-select certification picker. Visible only for employees and managers
 * (owners skip; they manage workers' certs from the admin web). Captured
 * certifications flow into mining-shift-planner's OSHA-TZ rule evaluator.
 */
export default function CertificationsStep(): JSX.Element {
  const { current, update, markStepComplete } = useOnboardingDraft()
  const t = useMemo(() => pickStrings(current.lang), [current.lang])
  const copy = t.onboarding.certifications
  const recommended = useMemo(
    () => recommendCertifications(current.roleHint, current.lang),
    [current.roleHint, current.lang]
  )

  useEffect(() => {
    if (current.role === 'owner') {
      router.replace('/onboarding/biometric')
    }
  }, [current.role])

  function toggle(cert: Certification): void {
    const exists = current.certifications.includes(cert)
    const nextList = exists
      ? current.certifications.filter((c) => c !== cert)
      : [...current.certifications, cert]
    update({ certifications: nextList })
  }

  function next(): void {
    markStepComplete('certifications')
    router.push('/onboarding/biometric')
  }

  const recommendedSet = useMemo(() => new Set(recommended), [recommended])
  const others = useMemo(
    () => CERTIFICATIONS.filter((cert) => !recommendedSet.has(cert)),
    [recommendedSet]
  )

  return (
    <WizardShell
      badge="CERTS"
      title={copy.title}
      subtitle={copy.subtitle}
      footer={<Button label={copy.cta} onPress={next} />}
    >
      {recommended.length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.blockHeader}>{copy.recommendedHeader}</Text>
          {recommended.map((cert) => (
            <CertRow
              key={cert}
              cert={cert}
              label={certLabel(cert, t)}
              selected={current.certifications.includes(cert)}
              recommended
              onPress={() => toggle(cert)}
            />
          ))}
        </View>
      ) : null}
      <View style={styles.block}>
        <Text style={styles.blockHeader}>{copy.allHeader}</Text>
        {others.map((cert) => (
          <CertRow
            key={cert}
            cert={cert}
            label={certLabel(cert, t)}
            selected={current.certifications.includes(cert)}
            recommended={false}
            onPress={() => toggle(cert)}
          />
        ))}
      </View>
    </WizardShell>
  )
}

interface CertRowProps {
  cert: Certification
  label: string
  selected: boolean
  recommended: boolean
  onPress: () => void
}

function CertRow({ label, selected, recommended, onPress }: CertRowProps): JSX.Element {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        selected ? styles.rowSelected : null,
        recommended ? styles.rowRecommended : null,
        pressed ? styles.rowPressed : null
      ]}
    >
      <View style={[styles.checkbox, selected ? styles.checkboxChecked : null]}>
        {selected ? <Text style={styles.checkmark}>{'✓'}</Text> : null}
      </View>
      <Text style={[styles.rowLabel, selected ? styles.rowLabelSelected : null]}>{label}</Text>
    </Pressable>
  )
}

function certLabel(cert: Certification, t: ReturnType<typeof pickStrings>): string {
  const copy = t.onboarding.certifications
  switch (cert) {
    case 'haul-truck-license':
      return copy.haulTruckLicense
    case 'excavator-license':
      return copy.excavatorLicense
    case 'underground-cert':
      return copy.undergroundCert
    case 'blaster-permit':
      return copy.blasterPermit
    case 'first-aid':
      return copy.firstAid
    case 'crusher-operator':
      return copy.crusherOperator
    case 'electrician-class-b':
      return copy.electricianClassB
    case 'confined-space':
      return copy.confinedSpace
    default:
      return cert
  }
}

const styles = StyleSheet.create({
  block: {
    marginBottom: spacing.lg
  },
  blockHeader: {
    color: colors.goldDark,
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: spacing.sm
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    marginBottom: spacing.sm
  },
  rowRecommended: {
    borderColor: colors.gold
  },
  rowSelected: {
    backgroundColor: colors.earth100
  },
  rowPressed: {
    opacity: 0.85
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.earth500,
    marginRight: spacing.md,
    alignItems: 'center',
    justifyContent: 'center'
  },
  checkboxChecked: {
    borderColor: colors.gold,
    backgroundColor: colors.gold
  },
  checkmark: {
    color: colors.earth900,
    fontSize: fontSize.body,
    fontWeight: '700'
  },
  rowLabel: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600'
  },
  rowLabelSelected: {
    color: colors.goldDark,
    fontWeight: '700'
  }
})
