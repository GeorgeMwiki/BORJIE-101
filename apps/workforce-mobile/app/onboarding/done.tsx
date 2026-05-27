import { useEffect, useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { Button } from '../../src/forms/Button'
import { WizardShell } from '../../src/onboarding/WizardShell'
import { useOnboardingDraft } from '../../src/onboarding/state'
import { useAuth } from '../../src/auth/useAuth'
import { workforcePersonaSpec } from '../../src/roles/persona'
import { pickStrings } from '../../src/i18n'
import type { Role } from '../../src/roles/types'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

/**
 * Final confirmation. Binds the persona slug from `workforcePersonaSpec` into
 * the draft so the future `persona-runtime` memory namespace can consume
 * `personaSlug + aiTone` verbatim when the brain-llm-router lands.
 */
export default function DoneStep(): JSX.Element {
  const { current, update, markStepComplete } = useOnboardingDraft()
  const { setRole } = useAuth()
  const t = useMemo(() => pickStrings(current.lang), [current.lang])
  const copy = t.onboarding.done

  useEffect(() => {
    if (current.role && current.personaSlug.length === 0) {
      const spec = workforcePersonaSpec(current.role)
      update({ personaSlug: spec.slug })
    }
  }, [current.role, current.personaSlug, update])

  function finish(): void {
    if (!current.role) {
      router.replace('/onboarding/role-detect')
      return
    }
    markStepComplete('done')
    setRole(current.role)
    router.replace('/(tabs)/home')
  }

  return (
    <WizardShell
      badge="READY"
      title={copy.title}
      subtitle={copy.subtitle}
      footer={<Button label={copy.cta} onPress={finish} disabled={!current.role} />}
    >
      <View style={styles.card}>
        <Text style={styles.cardHeader}>{copy.summaryHeader}</Text>
        <SummaryRow label={copy.summaryName} value={current.fullName} />
        <SummaryRow label={copy.summaryPhone} value={current.phone} />
        <SummaryRow label={copy.summaryRole} value={roleLabel(current.role, t)} />
        {current.role === 'owner' ? (
          <SummaryRow label={copy.summaryPml} value={current.pmlNumber} />
        ) : (
          <SummaryRow label={copy.summarySite} value={current.siteCode} />
        )}
        {current.certifications.length > 0 ? (
          <SummaryRow label={copy.summaryCerts} value={`${current.certifications.length}`} />
        ) : null}
        <SummaryRow label={copy.summaryTone} value={current.aiTone} />
        <SummaryRow
          label={copy.summaryBiometric}
          value={current.biometricEnrolled ? copy.summaryBiometricYes : copy.summaryBiometricNo}
        />
      </View>
    </WizardShell>
  )
}

interface SummaryRowProps {
  label: string
  value: string
}

function SummaryRow({ label, value }: SummaryRowProps): JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value || '—'}</Text>
    </View>
  )
}

function roleLabel(role: Role | null, t: ReturnType<typeof pickStrings>): string {
  if (!role) return '—'
  switch (role) {
    case 'owner':
      return t.onboarding.roleDetect.manualOwner
    case 'manager':
      return t.onboarding.roleDetect.manualManager
    case 'employee':
      return t.onboarding.roleDetect.manualEmployee
    default:
      return role
  }
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.earth100,
    borderWidth: 1,
    borderColor: colors.gold
  },
  cardHeader: {
    color: colors.goldDark,
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: spacing.md
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  rowLabel: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    fontWeight: '600'
  },
  rowValue: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '700',
    maxWidth: '60%',
    textAlign: 'right'
  }
})
