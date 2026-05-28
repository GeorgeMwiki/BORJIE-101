/**
 * Media generation barrel — image / chart / diagram / infographic.
 */

export { generateImage } from './image-generator.js';
export type { GenerateImageInput, GenerateImageOutput } from './image-generator.js';

export { generateChart } from './chart-generator.js';
export type {
  ChartKind,
  ChartSeries,
  GenerateChartInput,
  GenerateChartOutput,
} from './chart-generator.js';

export { generateDiagram } from './diagram-generator.js';
export type {
  DiagramKind,
  DiagramNode,
  DiagramEdge,
  GenerateDiagramInput,
  GenerateDiagramOutput,
} from './diagram-generator.js';

export { composeInfographic } from './infographic-composer.js';
export type {
  InfographicSlot,
  GenerateInfographicInput,
  GenerateInfographicOutput,
} from './infographic-composer.js';
