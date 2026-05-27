import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Slot, router, usePathname } from 'expo-router'
import { OnboardingDraftProvider, ONBOARDING_STEPS, type OnboardingStepId } from '../../src/onboarding/state'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

/**
 * Wizard layout — provides the OnboardingDraftProvider, a persistent header
 * with step indicator + progress bar + back button, and renders the active
 * step via <Slot />. The header reads the pathname to derive the active step
 * so step components stay focused on their own UI.
 */
export default function OnboardingLayout(): JSX.Element {
  return (
    <OnboardingDraftProvider initialLang="sw">
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
        <WizardHeader />
        <View style={styles.body}>
          <Slot />
        </View>
      </SafeAreaView>
    </OnboardingDraftProvider>
  )
}

function WizardHeader(): JSX.Element {
  const pathname = usePathname()
  const activeStep = useMemo<OnboardingStepId>(() => deriveStep(pathname), [pathname])
  const currentIdx = ONBOARDING_STEPS.indexOf(activeStep)
  const safeIdx = currentIdx < 0 ? 0 : currentIdx
  const total = ONBOARDING_STEPS.length
  const progress = ((safeIdx + 1) / total) * 100
  const canGoBack = safeIdx > 0 && safeIdx < total - 1

  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          disabled={!canGoBack}
          onPress={() => {
            if (router.canGoBack()) {
              router.back()
            }
          }}
          style={({ pressed }) => [
            styles.backBtn,
            !canGoBack ? styles.backBtnHidden : null,
            pressed ? styles.backBtnPressed : null
          ]}
        >
          <Text style={styles.backLabel}>{'‹'}</Text>
        </Pressable>
        <Text style={styles.stepLabel}>{`${safeIdx + 1} / ${total}`}</Text>
        <View style={styles.spacer} />
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress}%` }]} />
      </View>
    </View>
  )
}

function deriveStep(pathname: string | null): OnboardingStepId {
  if (!pathname) return 'welcome'
  for (const step of ONBOARDING_STEPS) {
    if (pathname.endsWith(`/onboarding/${step}`)) {
      return step
    }
  }
  return 'welcome'
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.surface
  },
  header: {
    backgroundColor: colors.earth700,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.earth500
  },
  backBtnHidden: {
    opacity: 0
  },
  backBtnPressed: {
    opacity: 0.7
  },
  backLabel: {
    color: colors.textInverse,
    fontSize: fontSize.h2,
    fontWeight: '700'
  },
  stepLabel: {
    flex: 1,
    textAlign: 'center',
    color: colors.textInverse,
    fontSize: fontSize.body,
    fontWeight: '700',
    letterSpacing: 1
  },
  spacer: {
    width: 36
  },
  progressTrack: {
    height: 4,
    marginTop: spacing.md,
    backgroundColor: colors.earth500,
    borderRadius: radius.pill,
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.goldLight,
    borderRadius: radius.pill
  },
  body: {
    flex: 1
  }
})
