/**
 * Mining-themed palette. Earth tones grounded by gold accents.
 * Designed to read well outdoors in bright sun on cheap devices.
 */
export const colors = {
  earth900: '#1F1410',
  earth800: '#2A1B14',
  earth700: '#3D2B1F',
  earth500: '#6B4A30',
  earth300: '#A07B58',
  earth100: '#E8DBC9',
  goldDark: '#B8860B',
  gold: '#D4A017',
  goldLight: '#F4C430',
  ore: '#5E3A1A',
  surface: '#FAF6EE',
  surfaceAlt: '#F0E6D2',
  text: '#1F1410',
  textMuted: '#5E4A3A',
  textInverse: '#FAF6EE',
  border: '#D9C8AE',
  success: '#3F7D3F',
  warn: '#C77700',
  danger: '#9E2A2B',
  online: '#3F7D3F',
  offline: '#9E2A2B'
} as const

export type ColorKey = keyof typeof colors
