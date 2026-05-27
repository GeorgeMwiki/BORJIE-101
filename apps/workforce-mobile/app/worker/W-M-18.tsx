import { useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { FingerprintPlaceholder } from '../../src/components/FingerprintPlaceholder'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-18'

type DocStatus = 'waiting' | 'signed'

interface OfficialDoc {
  id: string
  title: string
  refNumber: string
  issuedISO: string
  status: DocStatus
}

const SEED_DOCS: ReadonlyArray<OfficialDoc> = [
  {
    id: 'd-1',
    title: 'Mkataba wa Ajira ya Muda — Pit 2',
    refNumber: 'CON-2026-0418',
    issuedISO: '2026-05-26T08:30:00Z',
    status: 'waiting'
  },
  {
    id: 'd-2',
    title: 'Idhini ya Madini — Sehemu B',
    refNumber: 'PRM-2026-1102',
    issuedISO: '2026-05-25T14:12:00Z',
    status: 'waiting'
  },
  {
    id: 'd-3',
    title: 'Risiti ya Mishahara — Mei 2026',
    refNumber: 'PAY-2026-0531',
    issuedISO: '2026-05-23T11:00:00Z',
    status: 'signed'
  }
]

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <DocumentSigning />
      </ScreenShell>
    </RoleGuard>
  )
}

function DocumentSigning(): JSX.Element {
  const [docs, setDocs] = useState<ReadonlyArray<OfficialDoc>>(SEED_DOCS)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const select = useCallback((id: string): void => {
    setSelectedId(id)
  }, [])

  const sign = useCallback((): void => {
    if (!selectedId) return
    setDocs(
      docs.map((doc) =>
        doc.id === selectedId && doc.status === 'waiting'
          ? { ...doc, status: 'signed' }
          : doc
      )
    )
    setSelectedId(null)
  }, [docs, selectedId])

  const selectedDoc = useMemo<OfficialDoc | null>(
    () => docs.find((doc) => doc.id === selectedId) ?? null,
    [docs, selectedId]
  )

  const waitingCount = useMemo<number>(
    () => docs.filter((doc) => doc.status === 'waiting').length,
    [docs]
  )

  return (
    <View>
      <Section title={`Hati za rasmi (${waitingCount} zinasubiri)`}>
        {docs.map((doc) => (
          <Pressable
            key={doc.id}
            accessibilityRole="button"
            accessibilityLabel={doc.title}
            onPress={() => select(doc.id)}
            style={({ pressed }) => [
              styles.docRow,
              selectedId === doc.id ? styles.docRowSelected : null,
              pressed && styles.pressed
            ]}
          >
            <View style={styles.docBody}>
              <Text style={styles.docTitle}>{doc.title}</Text>
              <Text style={styles.docMeta}>
                {doc.refNumber} · {formatDate(doc.issuedISO)}
              </Text>
            </View>
            <View
              style={[
                styles.statusBadge,
                doc.status === 'signed' ? styles.statusSigned : styles.statusWaiting
              ]}
            >
              <Text style={styles.statusLabel}>
                {doc.status === 'signed' ? 'Imesainiwa' : 'Inasubiri'}
              </Text>
            </View>
          </Pressable>
        ))}
      </Section>
      <Section title="Tazama na saini">
        {selectedDoc ? (
          <View style={styles.preview}>
            <Text style={styles.previewTitle}>{selectedDoc.title}</Text>
            <Text style={styles.previewRef}>Ref: {selectedDoc.refNumber}</Text>
            <Text style={styles.previewBody}>
              Hii ni hati rasmi inayohitaji uthibitisho wa kidole. Kwa kusaini hapa,
              unakiri kuwa umesoma na kuelewa masharti yote ndani ya hati.
            </Text>
            {selectedDoc.status === 'waiting' ? (
              <FingerprintPlaceholder label="Saini kwa kidole" onSign={sign} />
            ) : (
              <Text style={styles.alreadySigned}>Hati hii tayari imesainiwa.</Text>
            )}
          </View>
        ) : (
          <Text style={styles.placeholder}>Chagua hati hapo juu ili kuona maelezo.</Text>
        )}
      </Section>
    </View>
  )
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return iso
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const styles = StyleSheet.create({
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: 'transparent'
  },
  docRowSelected: {
    borderColor: colors.gold,
    backgroundColor: colors.surface
  },
  pressed: {
    opacity: 0.85
  },
  docBody: {
    flex: 1
  },
  docTitle: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600'
  },
  docMeta: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs
  },
  statusBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill
  },
  statusWaiting: {
    backgroundColor: colors.warn
  },
  statusSigned: {
    backgroundColor: colors.success
  },
  statusLabel: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: fontSize.caption
  },
  preview: {
    padding: spacing.lg,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md
  },
  previewTitle: {
    color: colors.text,
    fontSize: fontSize.h3,
    fontWeight: '700'
  },
  previewRef: {
    color: colors.goldDark,
    fontSize: fontSize.caption,
    fontWeight: '700',
    marginTop: spacing.xs
  },
  previewBody: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.md,
    lineHeight: 20
  },
  alreadySigned: {
    color: colors.success,
    fontSize: fontSize.body,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: spacing.md
  },
  placeholder: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    padding: spacing.lg,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    textAlign: 'center'
  }
})
