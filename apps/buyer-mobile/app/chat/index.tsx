import { useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { PrimaryButton } from '@/components/PrimaryButton'
import { useTranslation } from '@/hooks/useTranslation'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'

interface Msg {
  readonly id: string
  readonly from: 'buyer' | 'seller'
  readonly body: string
}

const seed: readonly Msg[] = [
  { id: 'm1', from: 'seller', body: 'Habari. Karibu kuangalia kifurushi cha Geita.' },
  { id: 'm2', from: 'buyer', body: 'Asante. Naomba uthibitisho wa assay.' }
] as const

export default function ChatIndex() {
  const { t } = useTranslation()
  const [messages, setMessages] = useState<readonly Msg[]>(seed)
  const [draft, setDraft] = useState('')

  function handleSend(): void {
    const trimmed = draft.trim()
    if (!trimmed) {
      return
    }
    const next: Msg = { id: `m${messages.length + 1}`, from: 'buyer', body: trimmed }
    setMessages((prev) => [...prev, next])
    setDraft('')
  }

  return (
    <Screen scroll={false}>
      <SectionHeader title={t('chat.title')} />

      <View style={styles.list}>
        {messages.map((msg) => (
          <View
            key={msg.id}
            style={[styles.bubble, msg.from === 'buyer' ? styles.bubbleBuyer : styles.bubbleSeller]}
          >
            <Text style={styles.body}>{msg.body}</Text>
          </View>
        ))}
      </View>

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t('chat.placeholder')}
          placeholderTextColor={colors.inkMuted}
          style={styles.input}
        />
        <PrimaryButton label={t('chat.send')} onPress={handleSend} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { flex: 1, marginBottom: spacing.md },
  bubble: { padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm, maxWidth: '85%' },
  bubbleBuyer: { backgroundColor: colors.cream, alignSelf: 'flex-end' },
  bubbleSeller: { backgroundColor: colors.white, alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.line },
  body: { ...typography.body, color: colors.ink },
  composer: { gap: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
    color: colors.ink,
    ...typography.body
  }
})
