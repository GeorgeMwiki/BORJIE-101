/**
 * Capture barrel.
 */

export { parseExifGps } from './exif.js';
export {
  hashCapturePayload,
  signCapture,
  verifyCapture,
  type C2paSignaturePayload,
} from './c2pa-on-device.js';
export {
  createInMemoryCaptureStore,
  createCapturePipeline,
  defaultAiInference,
  type CaptureStore,
  type CapturePipelineDeps,
  type SubmitFieldCaptureArgs,
  type FieldCaptureInput,
  type AiInferenceFn,
} from './capture-pipeline.js';
