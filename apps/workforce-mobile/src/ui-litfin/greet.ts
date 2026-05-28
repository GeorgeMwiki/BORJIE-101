/**
 * Time-aware bilingual greeting helper — LitFin warm-but-professional
 * register. Never uses the SW welcome greeting in EN per CLAUDE.md.
 *
 * Returns the locale-appropriate greeting plus an optional warm opener.
 *
 *  Good morning, George.  /  Habari za asubuhi, George.
 *  Good afternoon …       /  Habari za mchana …
 *  Good evening …         /  Habari za jioni …
 */
export function greet(lang: 'sw' | 'en', name?: string | null, atHour?: number): string {
  const hour = typeof atHour === 'number' ? atHour : new Date().getHours()
  const part = pickDaypart(hour)
  if (lang === 'sw') {
    const base = swForPart(part)
    return name ? `${base}, ${name}.` : `${base}.`
  }
  const base = enForPart(part)
  return name ? `${base}, ${name}.` : `${base}.`
}

export function dayPart(atHour?: number): Daypart {
  const hour = typeof atHour === 'number' ? atHour : new Date().getHours()
  return pickDaypart(hour)
}

export type Daypart = 'morning' | 'afternoon' | 'evening'

function pickDaypart(hour: number): Daypart {
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

function swForPart(part: Daypart): string {
  if (part === 'morning') return 'Habari za asubuhi'
  if (part === 'afternoon') return 'Habari za mchana'
  return 'Habari za jioni'
}

function enForPart(part: Daypart): string {
  if (part === 'morning') return 'Good morning'
  if (part === 'afternoon') return 'Good afternoon'
  return 'Good evening'
}
