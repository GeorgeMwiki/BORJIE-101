import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'
import { ingestionStatusLabel, kindLabel, type UploadedDocument } from './types'

export interface DocumentListProps {
  readonly documents: ReadonlyArray<UploadedDocument>
  readonly onSelect?: (doc: UploadedDocument) => void
}

/**
 * DocumentList — Swahili-first list of uploaded documents with chip
 * badges for kind + ingestion status. Tapping a row delegates to the
 * caller (typically the Documents tab routes to DocumentExplorer).
 */
export function DocumentList({ documents, onSelect }: DocumentListProps): JSX.Element {
  if (documents.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Hakuna hati bado</Text>
        <Text style={styles.emptyBody}>
          Pakia mkataba, zabuni au barua kuanza mazungumzo na hati hizo.
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
          accessibilityLabel={`Fungua hati ${doc.fileName}`}
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
    fontSize: fontSize.h3,
    fontWeight: '700',
    color: colors.text,
  },
  emptyBody: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    textAlign: 'center',
    fontSize: fontSize.body,
  },
  row: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  rowPressed: {
    backgroundColor: colors.earth100,
  },
  rowMain: {
    flex: 1,
  },
  fileName: {
    fontWeight: '600',
    fontSize: fontSize.body,
    color: colors.text,
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
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipReady: {
    backgroundColor: '#DCEEDC',
    borderColor: colors.success,
  },
  chipFailed: {
    backgroundColor: '#F4D7D7',
    borderColor: colors.danger,
  },
  chipText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.text,
  },
  date: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
  },
})
