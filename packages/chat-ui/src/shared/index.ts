/**
 * shared/ — components consumed by BOTH the floating chat widget and
 * the home chat surface. Anything that needs to behave identically
 * across the two surfaces lives here, NOT in `widget/` or `home-shell/`.
 */
export {
  InlineRichRender,
  hasInlineRichContent,
  type InlineRichRenderProps,
  type InlineRichRenderVariant,
  type InlineBlackboardPayload,
  type InlineTabDetailPayload,
} from './InlineRichRender';
