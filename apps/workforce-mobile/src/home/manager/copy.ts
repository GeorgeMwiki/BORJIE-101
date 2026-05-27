/**
 * Bilingual copy for the Manager home (W-M-02M).
 *
 * Swahili-first per Borjie CLAUDE.md hard rule. Strings are inlined here
 * because per-screen i18n catalogue entries are owned by other agents this
 * wave. When the i18n catalogue lands, swap `pickCopy(lang, key)` for
 * `useI18n().screen('W-M-02M')` — the COPY map keys mirror the catalogue
 * shape so the swap is mechanical.
 *
 * Source for label conventions: research doc §9 (Brand-lock alignment) and
 * §0/§1/§4/§5 (terminology — "Mgodi", "Zamu", "Anza muhtasari", etc.).
 */

import type { Lang } from '../../auth/types'
import type { LocalizedCopy } from './types'

export const COPY = Object.freeze({
  title: { sw: 'Muhtasari wa Meneja', en: 'Manager Cockpit' },
  bandSitePulse: { sw: 'Mapigo ya Mgodi', en: 'Site Pulse' },
  bandExceptions: { sw: 'Vikwazo vya Sasa', en: 'Live Exceptions' },
  bandCrew: { sw: 'Wafanyakazi wa Zamu', en: 'Crew Roster' },
  bandTasks: { sw: 'Foleni ya Kazi', en: 'Task Queue' },
  bandApprovals: { sw: 'Maombi yanayosubiri', en: 'Approval Queue' },
  bandFooter: { sw: 'Muhtasari na Kuongeza Juu', en: 'Brief & Escalate' },
  kpiPlan: { sw: 'Mpango', en: 'Plan' },
  kpiCrew: { sw: 'Watu', en: 'Crew' },
  kpiEquipment: { sw: 'Vifaa', en: 'Equipment' },
  kpiAlerts: { sw: 'Tahadhari', en: 'Alerts' },
  kpiSafety: { sw: 'Usalama', en: 'Safety' },
  safetyGreen: { sw: 'Salama', en: 'Safe' },
  safetyAmber: { sw: 'Angalia', en: 'Watch' },
  safetyRed: { sw: 'Hatari', en: 'Danger' },
  statusOnSite: { sw: 'Yupo eneoni', en: 'On site' },
  statusLate: { sw: 'Amechelewa', en: 'Late' },
  statusBreak: { sw: 'Mapumziko', en: 'Break' },
  statusAbsent: { sw: 'Hayupo', en: 'Absent' },
  statusOff: { sw: 'Nje ya zamu', en: 'Off shift' },
  actionEscalate: { sw: 'Peleka kwa Mmiliki', en: 'Escalate' },
  actionReassign: { sw: 'Hamisha', en: 'Reassign' },
  actionInspect: { sw: 'Kagua', en: 'Inspect' },
  actionCall: { sw: 'Piga simu', en: 'Call' },
  actionApprove: { sw: 'Idhinisha', en: 'Approve' },
  actionDecline: { sw: 'Kataa', en: 'Decline' },
  actionSnooze: { sw: 'Ahirisha', en: 'Snooze' },
  actionConfirm: { sw: 'Thibitisha', en: 'Confirm' },
  actionWhy: { sw: 'Kwa nini?', en: 'Why?' },
  suggestPrefix: { sw: 'Borjie inapendekeza', en: 'Borjie suggests' },
  startHuddle: { sw: 'Anza muhtasari', en: 'Start huddle' },
  sendToOwner: { sw: 'Tuma kwa Mmiliki', en: 'Send up to owner' },
  emptyExceptions: { sw: 'Hakuna vikwazo. Kazi inaendelea.', en: 'No exceptions. Site running.' },
  emptyCrew: { sw: 'Hakuna watu walioandikishwa kwa zamu hii.', en: 'No crew rostered for this shift.' },
  emptyTasks: { sw: 'Foleni ya kazi haina cha kupanga.', en: 'No unassigned tasks.' },
  emptyApprovals: { sw: 'Hakuna maombi yanayosubiri.', en: 'No pending approvals.' },
  loading: { sw: 'Inapakia...', en: 'Loading...' },
  errorRetry: { sw: 'Imeshindikana. Gusa kujaribu tena.', en: 'Failed. Tap to retry.' },
  lineUpHint: {
    sw: 'Andaa mpango wa zamu na vikwazo, kisha tuma kwa wafanyakazi.',
    en: "Draft today's plan with barriers, then publish to the crew."
  },
  escalateHint: {
    sw: 'Tuma muktasari wa hali na hatua zilizojaribiwa kwa mmiliki.',
    en: 'Send the owner a pre-composed alert with what you tried.'
  },
  workloadLabel: { sw: 'Mzigo', en: 'Workload' },
  pendingLabel: { sw: 'zinasubiri', en: 'pending' }
}) as Readonly<Record<string, LocalizedCopy>>

export function pickCopy(lang: Lang, key: keyof typeof COPY): string {
  const entry = COPY[key]
  if (!entry) {
    return String(key)
  }
  return entry[lang] ?? entry.sw
}

export function pickStatus(lang: Lang, status: string): string {
  switch (status) {
    case 'on_site':
      return pickCopy(lang, 'statusOnSite')
    case 'late':
      return pickCopy(lang, 'statusLate')
    case 'break':
      return pickCopy(lang, 'statusBreak')
    case 'absent':
      return pickCopy(lang, 'statusAbsent')
    case 'off':
      return pickCopy(lang, 'statusOff')
    default:
      return status
  }
}

export function pickSafetyLabel(lang: Lang, status: 'green' | 'amber' | 'red'): string {
  if (status === 'green') {
    return pickCopy(lang, 'safetyGreen')
  }
  if (status === 'amber') {
    return pickCopy(lang, 'safetyAmber')
  }
  return pickCopy(lang, 'safetyRed')
}
