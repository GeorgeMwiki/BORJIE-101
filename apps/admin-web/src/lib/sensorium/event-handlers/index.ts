/**
 * Barrel — Central Command Phase A (C4 Brain Skin).
 *
 * Exposes the 14 install functions so `SensoriumProvider` can wire
 * them with a single import. The `allHandlers` array is the
 * canonical install order; each entry's `id` matches the event type.
 */

import type { SensoryHandler } from './types.js';
import { installPageViewHandler } from './page-view.js';
import { installPageLeaveHandler } from './page-leave.js';
import { installElementClickHandler } from './element-click.js';
import { installInputChangeHandler } from './input-change.js';
import { installFormSubmitHandler } from './form-submit.js';
import { installScrollDepthHandler } from './scroll-depth.js';
import { installDwellTimeHandler } from './dwell-time.js';
import { installFocusChangeHandler } from './focus-change.js';
import { installKeyboardShortcutHandler } from './keyboard-shortcut.js';
import { installCopyPasteHandler } from './copy-paste.js';
import { installViewportResizeHandler } from './viewport-resize.js';
import { installNetworkRequestHandler } from './network-request.js';
import { installErrorBoundaryHandler } from './error-boundary.js';
import { installA11yTreeDiffHandler } from './a11y-tree-diff.js';

export const ALL_HANDLERS: ReadonlyArray<SensoryHandler> = [
  { id: 'page.view', install: installPageViewHandler },
  { id: 'page.leave', install: installPageLeaveHandler },
  { id: 'element.click', install: installElementClickHandler },
  { id: 'input.change', install: installInputChangeHandler },
  { id: 'form.submit', install: installFormSubmitHandler },
  { id: 'scroll.depth', install: installScrollDepthHandler },
  { id: 'dwell.time', install: installDwellTimeHandler },
  { id: 'focus.change', install: installFocusChangeHandler },
  { id: 'keyboard.shortcut', install: installKeyboardShortcutHandler },
  { id: 'copy.paste', install: installCopyPasteHandler },
  { id: 'viewport.resize', install: installViewportResizeHandler },
  { id: 'network.request', install: installNetworkRequestHandler },
  { id: 'error.boundary', install: installErrorBoundaryHandler },
  { id: 'a11y.tree.diff', install: installA11yTreeDiffHandler },
];

export {
  installPageViewHandler,
  installPageLeaveHandler,
  installElementClickHandler,
  installInputChangeHandler,
  installFormSubmitHandler,
  installScrollDepthHandler,
  installDwellTimeHandler,
  installFocusChangeHandler,
  installKeyboardShortcutHandler,
  installCopyPasteHandler,
  installViewportResizeHandler,
  installNetworkRequestHandler,
  installErrorBoundaryHandler,
  installA11yTreeDiffHandler,
};

export type { SensoryHandler, EmitFn, HandlerContext, HandlerInstall } from './types.js';
