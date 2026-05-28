/**
 * Trigger parser — pure functions powering the slash + `@` menus.
 *
 * The parser is intentionally renderer-agnostic: it takes the current
 * composer text + caret position, decides whether the user is in a
 * slash-command or entity-reference trigger window, and returns the
 * partial query the menu should filter against. The host composer
 * supplies the catalog + entity provider via React props.
 *
 * Design choices:
 *   - A trigger window is OPEN as soon as the caret is immediately
 *     after `/` (at line start or after whitespace) or `@` (anywhere
 *     a word boundary precedes it). The window CLOSES when the user
 *     types whitespace, presses Escape, or selects a candidate.
 *   - `parseTrigger` is the single source of truth — composers call
 *     it on every onChange + onSelect.
 *   - `applySelection` returns the next composer state immutably
 *     (text + caret position) so React can render without mutation.
 *   - Bilingual labels: every command + entity carries an `{en, sw}`
 *     label so the menu UI can pick the active locale.
 */

export type TriggerKind = 'slash' | 'at' | 'none';

export interface TriggerState {
  readonly kind: TriggerKind;
  /** Caret-anchored query the menu should match against. */
  readonly query: string;
  /** Character index where the trigger token (`/` or `@`) starts. */
  readonly anchor: number;
  /** Caret index at the time the probe was made. */
  readonly caret: number;
}

export interface SlashCommand {
  readonly id: string;
  readonly label: { readonly en: string; readonly sw: string };
  readonly hint?: { readonly en: string; readonly sw: string };
  /** Optional category for grouping in the menu. */
  readonly category?: string;
  /** Persona slugs allowed to invoke this command. */
  readonly personaSlugs?: ReadonlyArray<string>;
}

export interface EntityReference {
  readonly id: string;
  readonly label: { readonly en: string; readonly sw: string };
  readonly kind:
    | 'site'
    | 'licence'
    | 'parcel'
    | 'counterparty'
    | 'document'
    | 'scope'
    | 'employee'
    | 'subsidiary'
    | 'custom';
  /** Optional secondary line for the menu (e.g. expiry date). */
  readonly hint?: { readonly en: string; readonly sw: string };
}

export interface ComposerSelection {
  readonly text: string;
  readonly caret: number;
}

const TRIGGER_SLASH = '/';
const TRIGGER_AT = '@';
const WHITESPACE = /\s/;
const ENTITY_WORD = /[\w\-./@:]/;

/**
 * Probe a string at the given caret position and return whether a
 * trigger is active. Pure function; no side effects.
 */
export function parseTrigger(text: string, caret: number): TriggerState {
  if (caret < 0 || caret > text.length) {
    return { kind: 'none', query: '', anchor: caret, caret };
  }
  // Walk backwards from the caret until we hit a whitespace or trigger.
  let index = caret - 1;
  while (index >= 0) {
    const ch = text[index];
    if (ch === undefined) break;
    if (ch === TRIGGER_SLASH || ch === TRIGGER_AT) {
      // For `/` we also require that the character immediately before
      // is whitespace or the start of the string. This avoids capturing
      // URLs ("https://...") as slash commands.
      if (ch === TRIGGER_SLASH) {
        const prev = index === 0 ? '' : text[index - 1];
        if (prev !== '' && prev !== undefined && !WHITESPACE.test(prev)) {
          return { kind: 'none', query: '', anchor: caret, caret };
        }
      }
      // For `@` we require the same word-boundary discipline so we
      // don't capture email addresses.
      if (ch === TRIGGER_AT) {
        const prev = index === 0 ? '' : text[index - 1];
        if (prev !== '' && prev !== undefined && !WHITESPACE.test(prev)) {
          return { kind: 'none', query: '', anchor: caret, caret };
        }
      }
      const query = text.slice(index + 1, caret);
      // If the trigger query already contains whitespace, the window
      // has closed.
      if (WHITESPACE.test(query)) {
        return { kind: 'none', query: '', anchor: caret, caret };
      }
      return {
        kind: ch === TRIGGER_SLASH ? 'slash' : 'at',
        query,
        anchor: index,
        caret,
      };
    }
    if (WHITESPACE.test(ch)) {
      return { kind: 'none', query: '', anchor: caret, caret };
    }
    if (!ENTITY_WORD.test(ch)) {
      return { kind: 'none', query: '', anchor: caret, caret };
    }
    index -= 1;
  }
  return { kind: 'none', query: '', anchor: caret, caret };
}

/**
 * Filter a slash command catalog by the active query + persona slug.
 * The host composer typically calls this in a `useMemo`.
 */
export function filterSlashCommands(
  catalog: ReadonlyArray<SlashCommand>,
  query: string,
  options?: { readonly personaSlug?: string; readonly locale?: 'en' | 'sw' },
): ReadonlyArray<SlashCommand> {
  const needle = query.trim().toLowerCase();
  const persona = options?.personaSlug;
  const locale = options?.locale ?? 'en';
  return catalog.filter((cmd) => {
    if (
      persona &&
      cmd.personaSlugs &&
      cmd.personaSlugs.length > 0 &&
      !cmd.personaSlugs.includes(persona)
    ) {
      return false;
    }
    if (needle.length === 0) return true;
    const label = cmd.label[locale].toLowerCase();
    const hint = cmd.hint?.[locale].toLowerCase() ?? '';
    return (
      cmd.id.toLowerCase().includes(needle) ||
      label.includes(needle) ||
      hint.includes(needle)
    );
  });
}

/**
 * Filter an entity catalog by the active query.
 */
export function filterEntities(
  catalog: ReadonlyArray<EntityReference>,
  query: string,
  options?: {
    readonly kinds?: ReadonlyArray<EntityReference['kind']>;
    readonly locale?: 'en' | 'sw';
  },
): ReadonlyArray<EntityReference> {
  const needle = query.trim().toLowerCase();
  const locale = options?.locale ?? 'en';
  const kindFilter = options?.kinds;
  return catalog.filter((entity) => {
    if (kindFilter && !kindFilter.includes(entity.kind)) return false;
    if (needle.length === 0) return true;
    const label = entity.label[locale].toLowerCase();
    return (
      entity.id.toLowerCase().includes(needle) ||
      label.includes(needle)
    );
  });
}

/**
 * Apply a selected slash command or entity to the composer state.
 * Replaces the trigger window (anchor → caret) with the rendered
 * token, leaving a trailing space so the user can keep typing.
 *
 * The rendered token for a slash command is `/<commandId> ` (the
 * orchestrator parses the leading slash to route to the brain tool).
 * The rendered token for an entity is `@<entityId> ` (the brain
 * resolves the @ token via its entity catalog).
 */
export function applySelection(
  current: ComposerSelection,
  trigger: TriggerState,
  selected: { readonly token: string },
): ComposerSelection {
  const before = current.text.slice(0, trigger.anchor);
  const after = current.text.slice(trigger.caret);
  const token = selected.token.endsWith(' ')
    ? selected.token
    : `${selected.token} `;
  const nextText = `${before}${token}${after}`;
  return {
    text: nextText,
    caret: before.length + token.length,
  };
}

/**
 * Convenience helper for tests / hosts that just want a snapshot of
 * the trigger state from a given composer selection.
 */
export function buildTriggerProbe(selection: ComposerSelection): TriggerState {
  return parseTrigger(selection.text, selection.caret);
}
