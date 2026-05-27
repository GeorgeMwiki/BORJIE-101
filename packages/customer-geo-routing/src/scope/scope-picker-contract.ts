/**
 * Scope picker contract — pure logic referenced by the login flow.
 *
 * Inputs:
 *   - The user's active `UserBindingLike[]` (revoked rows excluded)
 *   - Optional `remembered_default_scope_id` from
 *     `user_home_preferences` (Wave 18W)
 *
 * Output:
 *   - `ScopePickerOutcome` — either auto-resolved (single binding or
 *     remembered default with "remember this session" flag) or
 *     `requires_picker = true` for the UI to render.
 *
 * No I/O. The login flow handler:
 *   1. Calls this fn with the bindings array.
 *   2. If `requires_picker`, returns the options to the client.
 *   3. When the client posts back the chosen `scope_id`, the flow
 *      builds a SessionScope via `scope/session-scope-builder.ts` and
 *      establishes the session.
 */

import type {
  ScopePickerInput,
  ScopePickerOption,
  ScopePickerOutcome,
  SessionScopeOrigin,
  UserBindingLike,
} from '../types.js';

export interface ScopePickerArgs {
  readonly bindings: ReadonlyArray<UserBindingLike>;
  readonly remembered_default_scope_id?: string | null;
}

/**
 * Map a user's bindings to picker options + decide whether the picker
 * UI must render or the scope can be auto-resolved.
 */
export function planScopePicker(args: ScopePickerArgs): {
  readonly input: ScopePickerInput;
  readonly outcome: ScopePickerOutcome;
} {
  const active = args.bindings.filter((b) => b.revoked_at === null);
  const options = active.map((b): ScopePickerOption => mapToOption(
    b,
    args.remembered_default_scope_id ?? null,
  ));

  const sortedOptions = [...options].sort(byLastUsedDesc);

  const tenant_id = active[0]?.tenant_id ?? '';
  const user_id = active[0]?.user_id ?? '';

  const input: ScopePickerInput = {
    tenant_id,
    user_id,
    options: sortedOptions,
    remembered_default_scope_id: args.remembered_default_scope_id ?? null,
  };

  if (active.length === 0) {
    return {
      input,
      outcome: {
        requires_picker: false,
        origin: 'auto_single_binding',
      },
    };
  }
  if (active.length === 1) {
    const sole = sortedOptions[0];
    return {
      input,
      outcome: {
        requires_picker: false,
        ...(sole !== undefined ? { resolved_option: sole } : {}),
        origin: 'auto_single_binding',
      },
    };
  }

  // Multi-binding — picker required unless a remembered default exists
  // AND it still matches an active binding (else we silently fall back
  // to the picker).
  const remembered =
    args.remembered_default_scope_id !== undefined &&
    args.remembered_default_scope_id !== null
      ? sortedOptions.find(
          (o) => o.scope_id === args.remembered_default_scope_id,
        )
      : undefined;
  if (remembered) {
    return {
      input,
      outcome: {
        requires_picker: false,
        resolved_option: remembered,
        origin: 'remembered_default',
      },
    };
  }
  const origin: SessionScopeOrigin = 'picker_selection';
  return {
    input,
    outcome: {
      requires_picker: true,
      origin,
    },
  };
}

function mapToOption(
  binding: UserBindingLike,
  rememberedScopeId: string | null,
): ScopePickerOption {
  const scope_id = binding.scope_kind === 'tenant_root' ? null : binding.org_unit_id;
  const display_name =
    binding.scope_kind === 'tenant_root'
      ? 'General (all districts)'
      : binding.display_name ?? `Scope ${binding.org_unit_id ?? 'unknown'}`;
  return {
    scope_id,
    display_name,
    role: binding.role,
    authority_tier_max: binding.authority_tier_max,
    ...(binding.last_used_at !== undefined
      ? { last_used_at: binding.last_used_at }
      : {}),
    is_default: rememberedScopeId !== null && scope_id === rememberedScopeId,
  };
}

function byLastUsedDesc(a: ScopePickerOption, b: ScopePickerOption): number {
  const aTime = a.last_used_at ?? '';
  const bTime = b.last_used_at ?? '';
  if (aTime === bTime) {
    // Higher authority tier first as a stable tiebreaker.
    return b.authority_tier_max - a.authority_tier_max;
  }
  // Lexicographic descending on ISO timestamps puts the newest first.
  return aTime < bTime ? 1 : -1;
}
