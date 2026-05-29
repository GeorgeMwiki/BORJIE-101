/**
 * Tab-CRUD service — chat-driven dynamic tab CRUD support layer.
 *
 * Three modules:
 *   - config-validator: per-type schema for `<tab_spawn config>` /
 *     `<tab_update config>` so hallucinated keys are dropped.
 *   - process-tags:     consumes the parsed tab tags from
 *     `@borjie/central-intelligence`, validates each, publishes the
 *     cross-device cockpit-bus pulse, returns the SSE action list for
 *     the spawning device.
 */

export {
  validateTabConfig,
  type ValidateConfigErr,
  type ValidateConfigOk,
  type ValidateConfigResult,
} from './config-validator.js';

export {
  processTabTagsForOwner,
  type ProcessTabTagsInput,
  type TabAction,
} from './process-tags.js';
