import { z } from 'zod'

/**
 * UI-facing radio values. The submit payload maps these to the
 * api-gateway IncidentKindEnum (`safety` / `near_miss` /
 * `equipment_failure` / `environmental`) before POST.
 */
export const INCIDENT_KINDS = ['injury', 'near-miss', 'equipment', 'environmental'] as const
export type IncidentKind = (typeof INCIDENT_KINDS)[number]

export const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number]

export const incidentStep1Schema = z.object({
  kind: z.enum(INCIDENT_KINDS)
})

export const incidentStep2Schema = z.object({
  severity: z.enum(INCIDENT_SEVERITIES)
})

export const incidentStep3Schema = z.object({
  location: z.string().trim().min(2).max(200)
})

export const incidentStep5Schema = z.object({
  witnesses: z.string().trim().max(500).optional().default('')
})

export const incidentFullSchema = incidentStep1Schema
  .merge(incidentStep2Schema)
  .merge(incidentStep3Schema)
  .merge(incidentStep5Schema)

export type IncidentFullForm = z.infer<typeof incidentFullSchema>

export interface IncidentSubmitPhoto {
  uri: string
  capturedAt: number
  mimeType: string
}

export interface IncidentSubmitVoice {
  uri: string
  durationMs: number
  recordedAt: number
}

export interface IncidentLocalPayload {
  kind: IncidentKind
  severity: IncidentSeverity
  location: string
  gps: { latitude: number; longitude: number; accuracy: number | null; capturedAt: number } | null
  photos: ReadonlyArray<IncidentSubmitPhoto>
  voiceNote: IncidentSubmitVoice | null
  witnesses: ReadonlyArray<string>
  submittedAt: number
}

const KIND_REMOTE: Readonly<Record<IncidentKind, string>> = {
  injury: 'safety',
  'near-miss': 'near_miss',
  equipment: 'equipment_failure',
  environmental: 'environmental'
}

export interface IncidentRemotePayload {
  kind: string
  severity: IncidentSeverity
  occurredAt: string
  location: string
  description: string
  photos: ReadonlyArray<string>
  affectedUserIds: ReadonlyArray<string>
}

/**
 * Shape a local payload into the wire format expected by the
 * api-gateway CreateIncidentRequest schema (see
 * services/api-gateway/.../sales-incidents-schemas.ts). Maps the UI
 * kind to the IncidentKindEnum value and folds GPS + witnesses into
 * the `location` / `description` text fields.
 */
export function toRemotePayload(local: IncidentLocalPayload): IncidentRemotePayload {
  const witnessText =
    local.witnesses.length > 0 ? `\nWitnesses: ${local.witnesses.join(', ')}` : ''
  const voiceText = local.voiceNote ? `\nVoice note: ${local.voiceNote.uri}` : ''
  const gps = local.gps
    ? ` (GPS ${local.gps.latitude.toFixed(5)},${local.gps.longitude.toFixed(5)})`
    : ''
  return {
    kind: KIND_REMOTE[local.kind],
    severity: local.severity,
    occurredAt: new Date(local.submittedAt).toISOString(),
    location: `${local.location}${gps}`,
    description: `${local.location}${witnessText}${voiceText}`.trim(),
    photos: local.photos.map((p) => p.uri),
    affectedUserIds: local.witnesses
  }
}
