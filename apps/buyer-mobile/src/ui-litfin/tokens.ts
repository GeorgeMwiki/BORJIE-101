/**
 * LitFin DNA design tokens for buyer-mobile — RN-native rebrand of
 * the LitFin Tailwind tokens for direct use in StyleSheet.
 *
 * Single-sources from the existing buyer palette so colour truth
 * stays in `src/theme/colors.ts`. Adds the LitFin gold-on-navy
 * gradients, type ramp, radii, and shadow recipes adapted for
 * React Native's flat StyleSheet model.
 */
import { colors } from '@/theme/colors'

export const tokens = {
  color: {
    bgBase: colors.forestDeep,
    bgSurface: colors.forest,
    bgRaised: colors.forestSoft,
    bgMuted: colors.earth,
    bgHover: '#15192a',

    textPrimary: colors.cream,
    textSecondary: colors.sand,
    textMuted: colors.inkMuted,
    textInverse: colors.ink,

    gold: colors.gold,
    goldDeep: colors.goldSoft,
    goldSoft: colors.copper,
    goldRing: 'rgba(255, 200, 87, 0.32)',

    success: colors.success,
    warn: colors.warning,
    danger: colors.danger,

    border: 'rgba(255, 255, 255, 0.08)',
    borderStrong: 'rgba(255, 255, 255, 0.16)',
    borderGold: 'rgba(255, 200, 87, 0.40)',

    glassRaised: 'rgba(11, 15, 25, 0.66)',
    glassDeep: 'rgba(7, 10, 18, 0.85)',

    aiBubbleBg: colors.forestSoft,
    aiBubbleBorder: 'rgba(255, 200, 87, 0.22)',
    aiBubbleTopAccent: colors.gold,
    userBubbleBg: colors.gold,
    userBubbleText: colors.ink
  },

  radius: {
    xs: 8,
    sm: 12,
    md: 16,
    lg: 20,
    xl: 24,
    pill: 999
  },

  space: {
    px: 1,
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
    xxxl: 48
  },

  type: {
    hero: { fontSize: 40, fontWeight: '800' as const, letterSpacing: -1, lineHeight: 44 },
    h1: { fontSize: 32, fontWeight: '700' as const, letterSpacing: -0.8, lineHeight: 38 },
    h2: { fontSize: 24, fontWeight: '700' as const, letterSpacing: -0.6, lineHeight: 30 },
    h3: { fontSize: 20, fontWeight: '600' as const, letterSpacing: -0.4, lineHeight: 26 },
    section: { fontSize: 18, fontWeight: '600' as const, letterSpacing: -0.2, lineHeight: 24 },
    body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
    bodyStrong: { fontSize: 16, fontWeight: '600' as const, lineHeight: 24 },
    bodySm: { fontSize: 14, fontWeight: '400' as const, lineHeight: 20 },
    bodySmStrong: { fontSize: 14, fontWeight: '600' as const, lineHeight: 20 },
    micro: { fontSize: 12, fontWeight: '500' as const, lineHeight: 16, letterSpacing: 0.4 },
    eyebrow: {
      fontSize: 11,
      fontWeight: '700' as const,
      letterSpacing: 1.4,
      lineHeight: 14,
      textTransform: 'uppercase' as const
    }
  },

  shadow: {
    card: {
      shadowColor: '#000',
      shadowOpacity: 0.35,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
      elevation: 8
    },
    glow: {
      shadowColor: '#FFC857',
      shadowOpacity: 0.22,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6
    }
  }
} as const

export type LitFinTokens = typeof tokens
