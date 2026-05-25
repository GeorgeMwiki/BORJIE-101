/**
 * CONDITIONAL_SURVEY_TEMPLATE
 * Checklist template that guides conditional-survey field work.
 */

import type { ConditionalSurveySeverity } from './types.js';

export interface ConditionalSurveyTemplateArea {
  readonly id: string;
  readonly label: string;
  readonly prompts: readonly string[];
  readonly defaultSeverity: ConditionalSurveySeverity;
}

export interface ConditionalSurveyTemplateDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly areas: readonly ConditionalSurveyTemplateArea[];
}

export const CONDITIONAL_SURVEY_TEMPLATE: ConditionalSurveyTemplateDefinition =
  {
    id: 'conditional_survey_default_v1',
    label: 'Conditional Survey Report',
    description:
      'Structured inspection that produces findings and a remediation action plan.',
    areas: [
      {
        id: 'structure',
        label: 'Structure & Envelope',
        prompts: [
          'Foundation/substructure visible defects',
          'External walls — cracking, spalling, damp',
          'Roof — coverings, flashings, gutters',
          'Windows & doors — frames, seals',
        ],
        defaultSeverity: 'medium',
      },
      {
        id: 'mechanical',
        label: 'Mechanical & Plumbing',
        prompts: [
          'Water tanks & pumps',
          'Supply and waste plumbing',
          'HVAC units',
          'Water heaters / boilers',
        ],
        defaultSeverity: 'medium',
      },
      {
        id: 'electrical',
        label: 'Electrical',
        prompts: [
          'Distribution board',
          'Visible wiring and sockets',
          'Lighting circuits',
          'Earthing and RCD status',
        ],
        defaultSeverity: 'high',
      },
      {
        id: 'fire_safety',
        label: 'Fire & Life Safety',
        prompts: [
          'Smoke/heat detectors',
          'Extinguishers and signage',
          'Egress routes',
          'Emergency lighting',
        ],
        defaultSeverity: 'high',
      },
      {
        id: 'common_areas',
        label: 'Common Areas & Exterior',
        prompts: [
          'Landings and staircases',
          'Parking and driveways',
          'Fencing and gates',
          'Landscaping and drainage',
        ],
        defaultSeverity: 'low',
      },
      {
        id: 'interior',
        label: 'Interior Finishes',
        prompts: [
          'Floors — damage, wear',
          'Walls and ceilings',
          'Joinery and built-ins',
          'Appliances included in tenancy',
        ],
        defaultSeverity: 'low',
      },
    ],
  };
