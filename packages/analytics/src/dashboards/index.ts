/**
 * Barrel — dashboards public surface.
 */
export {
  composeFromTemplate,
  TEMPLATE_NAMES,
  type ComposeFromTemplateParams,
  type TemplateName,
} from './templates.js';
export {
  evaluateDashboard,
  type EvaluateDashboardInput,
  type QueryFetcher,
  type RenderedDashboard,
  type RenderedWidget,
} from './compose.js';
