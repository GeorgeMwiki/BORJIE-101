import { StyleSheet, Text, View } from 'react-native'
import { Card } from '@/components/Card'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'

export interface UnknownToolCardProps {
  readonly toolName: string
  readonly payload: unknown
}

// Fallback renderer for tool names the buyer surface doesn't recognise.
// We dump the payload as JSON so support can debug from the device,
// without leaking the raw error path through the chat bubble.

export function UnknownToolCard({ toolName, payload }: UnknownToolCardProps) {
  return (
    <Card>
      <Text style={styles.label}>tool · {toolName}</Text>
      <View style={styles.codeBlock}>
        <Text style={styles.code} numberOfLines={12}>
          {safeStringify(payload)}
        </Text>
      </View>
    </Card>
  )
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return '[unserialisable]'
  }
}

const styles = StyleSheet.create({
  label: {
    ...typography.micro,
    color: colors.inkMuted,
    textTransform: 'uppercase',
    marginBottom: spacing.sm
  },
  codeBlock: {
    backgroundColor: colors.cream,
    borderRadius: radius.md,
    padding: spacing.md
  },
  code: { ...typography.caption, color: colors.inkSoft, fontFamily: 'Courier' }
})
