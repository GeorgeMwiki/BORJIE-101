/**
 * Public surface for the generative-UI feature module.
 *
 * Brain tools should import builders from `@/core/brain/generative-ui/builders`
 * to construct specs; chat surfaces import `GenerativeUiMessage` from here
 * to render them.
 */

export { GenerativeUiMessage } from "./GenerativeUiMessage";
export { default as ChartVegaLite } from "./ChartVegaLite";
export { default as ChartRechartsTimeSeries } from "./ChartRechartsTimeSeries";
export { default as TableTanStack } from "./TableTanStack";
export { default as FormSchemaDriven } from "./FormSchemaDriven";
export { default as ConfirmDialog } from "./ConfirmDialog";
export { default as MetricGrid } from "./MetricGrid";
export { default as MapMapbox } from "./MapMapbox";
export { default as MermaidDiagram } from "./MermaidDiagram";
export { default as MarkdownRender } from "./MarkdownRender";
