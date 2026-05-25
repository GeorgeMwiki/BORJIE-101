/**
 * Maintenance Problem Taxonomy module — Wave 8 (S7 gap closure).
 */
export {
  createMaintenanceTaxonomyService,
  DrizzleMaintenanceTaxonomyRepository,
  MaintenanceTaxonomyError,
  MAINTENANCE_SEVERITIES,
  type MaintenanceTaxonomyService,
  type MaintenanceTaxonomyServiceDeps,
  type MaintenanceTaxonomyRepository,
  type MaintenanceCategory,
  type MaintenanceProblem,
  type MaintenanceSeverity,
  type ListProblemsFilters,
  type CreateCategoryInput,
  type CreateProblemInput,
  type DrizzleLike,
} from './maintenance-taxonomy-service.js';
