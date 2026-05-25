// Mining-themed palette: ore green, gold, copper, earth.
// Aligned with sibling workforce-mobile (#3D2B1F earth tone) but tuned toward
// the marketplace buyer surface — calmer, more trustworthy greens & golds.

export const colors = {
  forest: '#1B3A2F',
  forestDeep: '#0F2820',
  forestSoft: '#264A3D',
  gold: '#C9A14A',
  goldSoft: '#E5C77E',
  copper: '#B7651F',
  earth: '#3D2B1F',
  cream: '#F6F1E4',
  sand: '#EDE3CC',
  bone: '#FBF8F1',
  ink: '#1A1A1A',
  inkSoft: '#3F3F3F',
  inkMuted: '#6E6E6E',
  line: '#D9D2BD',
  success: '#2F7A4D',
  warning: '#C77A1F',
  danger: '#A93A2C',
  white: '#FFFFFF'
} as const

export type ColorToken = keyof typeof colors
