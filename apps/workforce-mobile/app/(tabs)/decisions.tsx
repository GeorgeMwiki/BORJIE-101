/**
 * Decisions tab — workforce-role-aware pending items.
 *
 * The original implementation hard-coded O-M-* owner screen IDs and
 * linked directly to /owner/* routes, leaking the owner nav surface to
 * employees and managers. This screen is mounted in the workforce-mobile
 * tab bar which is role-gated to employee / manager; the owner opens a
 * separate cockpit app.
 *
 * Fix: render a bilingual placeholder that surfaces the worker's own
 * pending decisions (leave approvals pending manager action, open
 * incidents assigned to me, etc.) drawn from brain-chat rather than
 * hard-coded owner deep-links. Tab is kept in the nav so the slot
 * exists; content is honest about scope.
 */
import { StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { useI18n } from '../../src/i18n/useI18n'
import { pickStrings } from '../../src/i18n'
import type { Lang } from '../../src/auth/types'
import { colors } from '../../src/theme/colors'
import { fontSize, spacing } from '../../src/theme/spacing'

export default function DecisionsTab(): JSX.Element {
  const { lang, t } = useI18n()
  return (
    <ScreenShell screenId="W-DECISIONS">
      <Section title={t.tabScreens.decisionsTitle}>
        <PendingDecisionsBody lang={lang} />
      </Section>
    </ScreenShell>
  )
}

function PendingDecisionsBody({
  lang,
}: {
  readonly lang: Lang
}): JSX.Element {
  // Single-language-per-active-locale copy via the i18n bundle. Placeholder:
  // pending decisions will be surfaced via the brain turn stream
  // (proposed_action frames) once the worker chat has a live session. The tab
  // slot is kept intentionally — the brain can push pending-decision cards here
  // via the dynamic-tab + portal-genui pipeline. For now render an honest empty
  // state rather than fake owner-screen deep links.
  const copy = pickStrings(lang).tabScreens
  return (
    <View style={styles.emptyWrap} testID="decisions-empty">
      <Text style={styles.emptyTitle}>{copy.decisionsEmptyTitle}</Text>
      <Text style={styles.emptyBody}>{copy.decisionsEmptyBody}</Text>
    </View>
  )
}

// Exported for use by tests or brain-injected content cards.
export { PendingDecisionsBody }

const styles = StyleSheet.create({
  emptyWrap: {
    paddingVertical: spacing.lg,
    gap: spacing.sm,
    alignItems: 'center'
  },
  emptyTitle: {
    color: colors.text,
    fontSize: fontSize.h3,
    fontWeight: '700',
    textAlign: 'center'
  },
  emptyBody: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 320
  }
})
