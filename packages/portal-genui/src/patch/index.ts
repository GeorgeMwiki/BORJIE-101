/**
 * Public surface for the A2UI-style incremental patch subsystem.
 *
 * The MD edits a LIVE `PortalTab` surface by emitting a flat list of
 * ID-addressed patch ops (`add-field` / `move-section` / `update-widget` …)
 * instead of regenerating the whole document. `applyTabPatch` is the pure
 * reducer that turns a patch + the current tab into a NEW validated tab.
 *
 * ADDITIVE: the whole-tab generation path in `../generator` is untouched.
 */

export {
  // Op schemas
  AddSectionOpSchema,
  RemoveSectionOpSchema,
  MoveSectionOpSchema,
  UpdateSectionOpSchema,
  AddFieldOpSchema,
  RemoveFieldOpSchema,
  UpdateFieldOpSchema,
  AddWidgetOpSchema,
  RemoveWidgetOpSchema,
  UpdateWidgetOpSchema,
  UpdateTabMetaOpSchema,
  // Union + patch
  PortalTabPatchOpSchema,
  PortalTabPatchSchema,
  PORTAL_TAB_PATCH_OP_KINDS,
  parsePortalTabPatch,
  safeParsePortalTabPatch,
  type PortalTabPatchOp,
  type PortalTabPatchOpKind,
  type PortalTabPatch,
} from './ops.js';

export {
  applyTabPatch,
  type ApplyTabPatchResult,
  type ApplyTabPatchOk,
  type ApplyTabPatchError,
  type ApplyTabPatchOptions,
} from './apply.js';
