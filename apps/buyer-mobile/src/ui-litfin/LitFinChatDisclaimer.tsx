import { StyleSheet, Text, View } from 'react-native'
import { tokens } from './tokens'

export interface LitFinChatDisclaimerProps {
  /**
   * Active locale, resolved by the host from the single source of truth
   * (the app locale / `user.preferredLang`). One language per render — no
   * mixing. Defaults to `en`.
   */
  readonly language?: 'en' | 'sw'
  readonly testID?: string
}

// Mining-estate disclaimer — verbatim parity with the canonical web source
// (packages/chat-ui/src/litfin-primitives.tsx → ChatShellDisclaimer). The
// "mine owner" / "mmiliki wa mgodi" persona attribution is a hard product
// rule: Mr. Mwikila advises, the mine owner decides.
const DISCLAIMER: Readonly<Record<'en' | 'sw', string>> = {
  en: 'AI-generated. Not legal/operational advice. Decisions are made by the mine owner.',
  sw: 'Imezalishwa na AI. Si ushauri wa kisheria/uendeshaji. Maamuzi yanafanywa na mmiliki wa mgodi.'
}

/**
 * LitFin chat compliance notice — a shield badge + the single-locale
 * "AI-generated · not advice · mine owner decides" line, pinned above the
 * composer exactly like the web shell.
 */
export function LitFinChatDisclaimer({
  language = 'en',
  testID
}: LitFinChatDisclaimerProps): JSX.Element {
  return (
    <View style={styles.wrap} accessibilityRole="text" testID={testID}>
      <View style={styles.shield}>
        <View style={styles.shieldTick} />
      </View>
      <Text style={styles.text} numberOfLines={2}>
        {DISCLAIMER[language]}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
    borderTopWidth: 1,
    borderTopColor: tokens.color.border,
    backgroundColor: tokens.color.bgRaised,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.sm
  },
  // Small shield-check badge built from Views (no icon dep) — the RN stand-in
  // for the web lucide `ShieldCheck`.
  shield: {
    width: 14,
    height: 15,
    borderRadius: 4,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    backgroundColor: 'rgba(46, 189, 133, 0.18)',
    borderWidth: 1,
    borderColor: tokens.color.success,
    alignItems: 'center',
    justifyContent: 'center'
  },
  shieldTick: {
    width: 5,
    height: 3,
    borderLeftWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: tokens.color.success,
    transform: [{ rotate: '-45deg' }],
    marginTop: -1
  },
  text: {
    ...tokens.type.micro,
    flex: 1,
    color: tokens.color.textMuted
  }
})
