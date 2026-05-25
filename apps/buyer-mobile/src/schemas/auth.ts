import { z } from 'zod'

export const phoneSchema = z.object({
  phone: z
    .string()
    .min(9, 'phone_too_short')
    .regex(/^\+?\d[\d\s-]{7,}$/, 'phone_invalid')
})

export const otpSchema = z.object({
  code: z.string().regex(/^\d{4,6}$/, 'otp_invalid')
})

export type PhoneInput = z.infer<typeof phoneSchema>
export type OtpInput = z.infer<typeof otpSchema>
