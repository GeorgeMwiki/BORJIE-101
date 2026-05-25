import { z } from 'zod'

export const attendanceDirectionSchema = z.enum(['in', 'out'])
export type AttendanceDirection = z.infer<typeof attendanceDirectionSchema>

export interface AttendancePayload {
  direction: AttendanceDirection
  gps: {
    latitude: number
    longitude: number
    accuracy: number | null
    capturedAt: number
  }
  fence: {
    siteId: string
    siteName: string
    insideFence: boolean
    distanceMeters: number
  }
  biometric: {
    method: 'fingerprint' | 'face' | 'passcode' | 'stub'
    signedAt: number
  }
  submittedAt: number
}
