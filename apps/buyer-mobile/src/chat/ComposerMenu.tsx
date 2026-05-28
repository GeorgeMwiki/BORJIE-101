/**
 * ComposerMenu — RN-native sibling of @borjie/chat-ui/composer's
 * SlashMenu + AtMenu. Renders an inline pop-up above the buyer chat
 * composer with up to MAX_ROWS rows. Tap a row to select.
 *
 * Web composer primitives are <div>+CSS only (per the chat-first
 * manifesto principle 8); this file mirrors the SAME data contract so
 * a single brain catalog drives both surfaces.
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { colors } from '@/theme/colors'
import { radius, spacing, typography } from '@/theme/spacing'
import type {
  EntityItem,
  SlashCommandItem
} from './composer-triggers'

const MAX_ROWS = 6

export interface SlashMenuProps {
  readonly commands: ReadonlyArray<SlashCommandItem>
  readonly locale: 'en' | 'sw'
  readonly onSelect: (cmd: SlashCommandItem) => void
}

export interface AtMenuProps {
  readonly entities: ReadonlyArray<EntityItem>
  readonly locale: 'en' | 'sw'
  readonly onSelect: (entity: EntityItem) => void
}

function emptyLabel(locale: 'en' | 'sw', kind: 'cmd' | 'entity'): string {
  if (locale === 'sw') {
    return kind === 'cmd'
      ? 'Hakuna amri inayolingana.'
      : 'Hakuna kitu kinacholingana.'
  }
  return kind === 'cmd'
    ? 'No matching commands.'
    : 'No matching entities.'
}

export function SlashMenu({ commands, locale, onSelect }: SlashMenuProps) {
  const rows = commands.slice(0, MAX_ROWS)
  return (
    <View style={styles.menu} testID="buyer-chat-slash-menu">
      {rows.length === 0 ? (
        <Text style={styles.emptyText}>{emptyLabel(locale, 'cmd')}</Text>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled">
          {rows.map((cmd) => (
            <Pressable
              key={cmd.id}
              testID={`buyer-chat-slash-${cmd.id}`}
              onPress={() => onSelect(cmd)}
              accessibilityRole="button"
              accessibilityLabel={cmd.label[locale]}
              style={({ pressed }) => [
                styles.row,
                pressed ? styles.rowPressed : null
              ]}
            >
              <Text style={styles.label}>{cmd.label[locale]}</Text>
              {cmd.hint ? (
                <Text style={styles.hint}>{cmd.hint[locale]}</Text>
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  )
}

export function AtMenu({ entities, locale, onSelect }: AtMenuProps) {
  const rows = entities.slice(0, MAX_ROWS)
  return (
    <View style={styles.menu} testID="buyer-chat-at-menu">
      {rows.length === 0 ? (
        <Text style={styles.emptyText}>{emptyLabel(locale, 'entity')}</Text>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled">
          {rows.map((entity) => (
            <Pressable
              key={entity.id}
              testID={`buyer-chat-at-${entity.id}`}
              onPress={() => onSelect(entity)}
              accessibilityRole="button"
              accessibilityLabel={entity.label[locale]}
              style={({ pressed }) => [
                styles.row,
                pressed ? styles.rowPressed : null
              ]}
            >
              <Text style={styles.label}>{entity.label[locale]}</Text>
              <Text style={styles.hint}>
                {entity.kind}
                {entity.hint ? ` · ${entity.hint[locale]}` : ''}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  menu: {
    maxHeight: 240,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.forestSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 200, 87, 0.32)',
    overflow: 'hidden'
  },
  row: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)'
  },
  rowPressed: {
    backgroundColor: colors.earth
  },
  label: {
    ...typography.bodyStrong,
    color: colors.cream
  },
  hint: {
    ...typography.caption,
    color: colors.sand,
    marginTop: 2
  },
  emptyText: {
    ...typography.caption,
    padding: spacing.md,
    color: colors.sand,
    textAlign: 'center'
  }
})
