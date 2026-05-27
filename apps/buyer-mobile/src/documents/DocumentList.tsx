import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'
import { ingestionStatusLabel, kindLabel, type UploadedDocument } from './types'

export interface DocumentListProps {
  readonly documents: ReadonlyArray<UploadedDocument>
  readonly onSelect?: (doc: UploadedDocument) => void
}

export function DocumentList({ documents, onSelect }: DocumentListProps) {
  if (documents.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No documents yet</Text>
        <Text style={styles.emptyBody}>
          Upload a contract, RFP, or report to start chatting with it.
        </Text>
      </View>
    )
  }
  return (
    <View style={styles.list}>
      {documents.map((doc) => (
        <Pressable
          key={doc.id}
          accessibilityRole="button"
          accessibilityLabel={`Open document ${doc.fileName}`}
          onPress={() => onSelect?.(doc)}
          style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
        >
          <View style={styles.rowMain}>
            <Text style={styles.fileName} numberOfLines={1}>
              {doc.fileName}
            </Text>
            <View style={styles.chipRow}>
              <View style={styles.chip}>
                <Text style={styles.chipText}>{kindLabel(doc.kind)}</Text>
              </View>
              <View
                style={[
                  styles.chip,
                  doc.ingestionStatus === 'ready' ? styles.chipReady : null,
                  doc.ingestionStatus === 'failed' ? styles.chipFailed : null,
                ]}
              >
                <Text style={styles.chipText}>{ingestionStatusLabel(doc.ingestionStatus)}</Text>
              </View>
            </View>
          </View>
          <Text style={styles.date}>{formatShortDate(doc.createdAt)}</Text>
        </Pressable>
      ))}
    </View>
  )
}

function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getDate()}/${d.getMonth() + 1}`
  } catch {
    return ''
  }
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  empty: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyTitle: {
    ...typography.heading,
    color: colors.ink,
  },
  emptyBody: {
    ...typography.body,
    color: colors.inkMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  row: {
    padding: spacing.md,
    backgroundColor: colors.bone,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  rowPressed: {
    backgroundColor: colors.cream,
  },
  rowMain: {
    flex: 1,
  },
  fileName: {
    ...typography.bodyStrong,
    color: colors.ink,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  chip: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.sand,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipReady: {
    backgroundColor: '#DCEEDC',
    borderColor: colors.success,
  },
  chipFailed: {
    backgroundColor: '#F4D7D7',
    borderColor: '#9E2A2B',
  },
  chipText: {
    ...typography.micro,
    color: colors.ink,
  },
  date: {
    ...typography.caption,
    color: colors.inkMuted,
  },
})
