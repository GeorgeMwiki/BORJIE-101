/**
 * IoT module — Wave 8 (S3 gap closure).
 * Exports the service factory + public types.
 */
export {
  createIotService,
  detectAnomalies,
  IotServiceError,
  type IotService,
  type IotServiceDeps,
  type IotSensor,
  type IotObservation,
  type IotAnomaly,
  type IotSensorKind,
  type IotAnomalyType,
  type IotAnomalySeverity,
  type IotObservationQuality,
  type RegisterSensorInput,
  type IngestObservationInput,
  type IngestResult,
  type ListSensorFilters,
  type ListObservationsOptions,
  type ListAnomaliesFilters,
  type AnomalyDescriptor,
} from './iot-service.js';
