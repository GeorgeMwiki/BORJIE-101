import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Field } from '../../src/forms/Field'
import { Button } from '../../src/forms/Button'
import { AskBorjie } from '../../src/components/AskBorjie'
import { MessageBubble } from '../../src/chat/MessageBubble'
import { useChat } from '../../src/chat/useChat'
import { useI18n } from '../../src/i18n/useI18n'
import { colors } from '../../src/theme/colors'
import { fontSize, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-02'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID} scroll={false}>
        <ChatView />
      </ScreenShell>
    </RoleGuard>
  )
}

function ChatView(): JSX.Element {
  const { t } = useI18n()
  const chat = useChat()
  const [draft, setDraft] = useState<string>('')

  const onSend = useCallback(async (): Promise<void> => {
    const text = draft
    setDraft('')
    await chat.send(text)
  }, [chat, draft])

  return (
    <View style={styles.wrap}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {chat.state.messages.length === 0 ? (
          <Section title={t.askBorjie.placeholder}>
            <Text style={styles.empty}>{t.askBorjie.emptyChat}</Text>
            <AskBorjie label={t.askBorjie.voiceButton} />
          </Section>
        ) : (
          <View style={styles.thread}>
            {chat.state.messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                sourcesLabel={t.askBorjie.sources}
                thinkingLabel={t.askBorjie.thinking}
              />
            ))}
            {chat.state.error ? (
              <Text style={styles.error}>{t.askBorjie.errorChat}</Text>
            ) : null}
          </View>
        )}
      </ScrollView>
      <View style={styles.composer}>
        <Field
          label={t.askBorjie.placeholder}
          value={draft}
          onChangeText={setDraft}
          multiline
        />
        <View style={styles.composerRow}>
          <Button label={t.askBorjie.send} onPress={() => void onSend()} disabled={chat.state.sending || draft.trim().length === 0} loading={chat.state.sending} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.askBorjie.voiceButton}
            style={styles.voiceBtn}
            onPress={() => {
              // LATER(#14,#22): requires EAS dev build — hook up Swahili
              // STT in the voice phase. For now we simply prefill a
              // placeholder so the owner can edit before sending.
              // See KI-DEBT-002.
              setDraft((current) => (current.length === 0 ? t.app.listening : current))
            }}
          >
            <Text style={styles.voiceBtnLabel}>{t.askBorjie.voiceButton}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1
  },
  scroll: {
    flexGrow: 1,
    paddingBottom: spacing.md
  },
  thread: {
    gap: spacing.xs
  },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginBottom: spacing.md
  },
  composer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md
  },
  composerRow: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  voiceBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.earth700,
    borderRadius: spacing.md,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center'
  },
  voiceBtnLabel: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: fontSize.body
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.body,
    marginTop: spacing.sm
  }
})
