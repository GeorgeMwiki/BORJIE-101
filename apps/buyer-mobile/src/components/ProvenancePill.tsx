import { Pressable, StyleSheet, Text, View } from 'react-native'
import { tokens } from '@/ui-litfin'
import type { ProvenanceEnvelope } from '@/types/listing'

/**
 * Buyer-mobile equivalent of the owner-web ProvenancePill.
 *
 * Implements principle 5 of the Chat-as-OS Bidirectional Parity
 * Manifesto: every bid / inquiry / kyc row in a buyer-mobile list
 * surfaces the path that produced it. Chat-created rows get a small
 * gold pill; tapping opens the originating chat session.
 *
 * Hidden for `via: 'legacy'` and `via: 'unknown'` to keep older rows
 * uncluttered.
 */

interface ProvenancePillProps {
  readonly provenance: ProvenanceEnvelope | undefined | null
  readonly onPress?: (sessionId: string, turnId: string | null) => void
}

const LABEL: Record<ProvenanceEnvelope['via'], string> = {
  chat: 'via Mr. Mwikila',
  form: 'via you',
  agent_apply: 'via agent',
  api: 'via API',
  legacy: 'legacy',
  unknown: 'unknown'
}

export function ProvenancePill({ provenance, onPress }: ProvenancePillProps) {
  if (!provenance) return null
  if (provenance.via === 'legacy' || provenance.via === 'unknown') return null

  const tone =
    provenance.via === 'chat' ? tokens.color.gold : tokens.color.textMuted
  const label = LABEL[provenance.via]
  const tappable = provenance.via === 'chat' && !!provenance.sessionId && !!onPress

  if (tappable && provenance.sessionId) {
    const sid = provenance.sessionId
    return (
      <Pressable
        onPress={() => onPress(sid, provenance.turnId ?? null)}
        style={[styles.pill, { borderColor: tone }]}
        accessibilityRole="button"
        accessibilityLabel={`${label} — open chat session`}
      >
        <Text style={[styles.label, { color: tone }]}>{label}</Text>
      </Pressable>
    )
  }

  return (
    <View style={[styles.pill, { borderColor: tone }]}>
      <Text style={[styles.label, { color: tone }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1
  },
  label: {
    fontSize: 10,
    fontWeight: '600'
  }
})
