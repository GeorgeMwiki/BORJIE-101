/**
 * Public theme spec shared between report-engine and presentation-engine.
 *
 * The presentation-engine package re-exports this type; report-engine's
 * pptx renderer accepts it as an optional theme override on the
 * `renderReportPptx` input.
 *
 * Lives in report-engine (not presentation-engine) so the .pptx
 * renderer can compile without a back-pointer dependency. When both
 * packages are imported together, the consumer can use either name —
 * they refer to the same type.
 */
export interface PresentationSlideMasterSpec {
  readonly dimensions?: { readonly w: number; readonly h: number };
  readonly colors?: {
    readonly primary?: string;
    readonly secondary?: string;
    readonly accent?: string;
    readonly text?: string;
    readonly background?: string;
    readonly muted?: string;
  };
  readonly fonts?: {
    readonly title?: string;
    readonly body?: string;
    readonly accent?: string;
  };
  readonly logoPosition?: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly anchor:
      | 'top-left'
      | 'top-right'
      | 'bottom-left'
      | 'bottom-right';
  };
  readonly layouts?: readonly string[];
}
