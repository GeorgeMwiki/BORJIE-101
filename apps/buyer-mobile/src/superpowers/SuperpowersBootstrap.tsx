/**
 * SuperpowersBootstrap — mounts the three always-on surfaces (SearchFab,
 * undo toast, bulk action chip) for buyer-mobile.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'
import { undoToastBus, bulkActionBus, type UndoToastEvent } from './bus'
import { undoJournalIds } from './undo'
import { navigateToTarget, DEFAULT_BUYER_TARGETS, type NavigateTarget } from './navigate'
import { runUniversalSearch, getRecentSearches, rememberRecentSearch, type SearchResult } from './search'
import { getLiveBulkSelection, runBuyerBulkAction } from './bulk'

interface UndoState {
  readonly toast: UndoToastEvent
  readonly secondsLeft: number
}

function UndoToastMount(): JSX.Element | null {
  const [state, setState] = useState<UndoState | null>(null)
  const [undone, setUndone] = useState(false)

  useEffect(() => {
    return undoToastBus.subscribe((toast) => {
      setUndone(false)
      setState({ toast, secondsLeft: toast.windowSeconds ?? 8 })
    })
  }, [])

  useEffect(() => {
    if (!state || undone || state.secondsLeft <= 0) return
    const t = setTimeout(() => {
      setState((prev) => (prev ? { ...prev, secondsLeft: prev.secondsLeft - 1 } : prev))
    }, 1000)
    return () => clearTimeout(t)
  }, [state, undone])

  const onUndo = useCallback(async () => {
    if (!state || undone) return
    const ok = await undoJournalIds(state.toast.journalIds)
    setUndone(ok)
    if (ok) {
      setTimeout(() => setState(null), 1500)
    }
  }, [state, undone])

  if (!state || state.secondsLeft <= 0) return null

  return (
    <View style={styles.undoToastWrap} pointerEvents="box-none">
      <View style={styles.undoToast}>
        <Text style={styles.undoLabel} numberOfLines={1}>
          {undone ? 'Undone' : state.toast.label}
        </Text>
        {!undone && state.toast.journalIds.length > 0 ? (
          <TouchableOpacity
            onPress={() => void onUndo()}
            style={styles.undoButton}
            accessibilityRole="button"
            accessibilityLabel="Undo last action"
            hitSlop={8}
          >
            <Text style={styles.undoButtonText}>Undo ({state.secondsLeft})</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  )
}

function BulkActionMount(): JSX.Element | null {
  const [tick, setTick] = useState(0)
  useEffect(() => bulkActionBus.subscribe(() => setTick((n) => n + 1)), [])
  const sel = getLiveBulkSelection()
  if (!sel || sel.ids.length === 0) return null
  return (
    <View key={tick} style={styles.bulkChipWrap} pointerEvents="box-none">
      <View style={styles.bulkChip}>
        <Text style={styles.bulkChipText}>{sel.ids.length} selected</Text>
        <TouchableOpacity
          onPress={() => {
            void runBuyerBulkAction(sel.entityType, sel.ids, 'bulk_rfb', `RFB sent on ${sel.ids.length}`)
          }}
          style={styles.bulkChipAction}
          accessibilityRole="button"
          accessibilityLabel="Send bulk request-for-bids"
          hitSlop={8}
        >
          <Text style={styles.bulkChipActionText}>Bulk RFB</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            void runBuyerBulkAction(sel.entityType, sel.ids, 'bulk_watch', `Watching ${sel.ids.length}`)
          }}
          style={styles.bulkChipAction}
          accessibilityRole="button"
          accessibilityLabel="Bulk add to watchlist"
          hitSlop={8}
        >
          <Text style={styles.bulkChipActionText}>Watch</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

function SearchFab(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ReadonlyArray<SearchResult>>([])

  useEffect(() => {
    if (!open) return
    const handle = setTimeout(() => {
      if (query.trim().length === 0) {
        setResults(getRecentSearches())
        return
      }
      void runUniversalSearch(query).then(setResults)
    }, 200)
    return () => clearTimeout(handle)
  }, [open, query])

  const onPickTarget = useCallback((t: NavigateTarget) => {
    rememberRecentSearch(t)
    setOpen(false)
    setQuery('')
    navigateToTarget(t)
  }, [])

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={styles.fab}
        accessibilityRole="button"
        accessibilityLabel="Open universal search"
        hitSlop={6}
      >
        <Text style={styles.fabText}>?</Text>
      </TouchableOpacity>
      <Modal animationType="fade" transparent visible={open} onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search…"
              placeholderTextColor={colors.inkMuted}
              value={query}
              onChangeText={setQuery}
              autoFocus
              accessibilityLabel="Universal search input"
            />
            <View style={styles.resultsList}>
              {(results.length > 0 ? results : DEFAULT_BUYER_TARGETS).map((r) => (
                <TouchableOpacity
                  key={`${r.route}-${r.label}`}
                  onPress={() => onPickTarget(r)}
                  style={styles.resultRow}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${r.label}`}
                >
                  <Text style={styles.resultLabel}>{r.label}</Text>
                  <Text style={styles.resultRoute}>{r.route}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  )
}

export function SuperpowersBootstrap(): JSX.Element {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <BulkActionMount />
      <UndoToastMount />
      <SearchFab />
    </View>
  )
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.xxxl + spacing.md,
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.forestDeep,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6
  },
  fabText: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: '700'
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingTop: spacing.xxxl,
    alignItems: 'center'
  },
  modalCard: {
    width: '92%',
    backgroundColor: colors.forestSoft,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line
  },
  searchInput: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.steel,
    color: colors.cream,
    backgroundColor: colors.forest,
    ...typography.body
  },
  resultsList: {
    gap: spacing.xs
  },
  resultRow: {
    minHeight: 44,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.forest
  },
  resultLabel: {
    color: colors.cream,
    ...typography.bodyStrong
  },
  resultRoute: {
    color: colors.inkMuted,
    ...typography.caption,
    marginTop: 2
  },
  undoToastWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: spacing.xxxl + 80,
    alignItems: 'center'
  },
  undoToast: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.forestSoft,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    gap: spacing.md,
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    maxWidth: '92%'
  },
  undoLabel: {
    color: colors.cream,
    ...typography.body,
    flexShrink: 1
  },
  undoButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.gold,
    minHeight: 32
  },
  undoButtonText: {
    color: colors.ink,
    ...typography.bodyStrong
  },
  bulkChipWrap: {
    position: 'absolute',
    top: spacing.xxl + spacing.md,
    left: 0,
    right: 0,
    alignItems: 'center'
  },
  bulkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.forestSoft,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line
  },
  bulkChipText: {
    color: colors.cream,
    ...typography.bodyStrong
  },
  bulkChipAction: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.gold,
    minHeight: 32
  },
  bulkChipActionText: {
    color: colors.ink,
    ...typography.bodyStrong
  }
})
