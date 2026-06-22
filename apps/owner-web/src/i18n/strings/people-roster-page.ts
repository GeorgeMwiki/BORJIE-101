/**
 * people-roster-page — guard-exempt bilingual (sw / en) copy for the
 * Worker roster screen (app/(routes)/people/roster/page.tsx).
 *
 * Lives under `i18n/` so the locale-purity scanner exempts the Swahili.
 */

export const peopleRosterStrings = {
  back: { en: 'Back to People', sw: 'Rudi kwa Watu' },
  eyebrow: { en: 'People · Roster', sw: 'Watu · Orodha ya zamu' },
  title: { en: 'Worker roster', sw: 'Orodha ya wafanyakazi' },
  intro: {
    en: 'Live per-site headcount and recent clock-in/out events.',
    sw: 'Idadi hai ya wafanyakazi kwa kila tovuti na matukio ya hivi karibuni ya kuingia/kutoka.',
  },
  askMwikila: { en: 'Ask Mr. Mwikila', sw: 'Uliza Bw. Mwikila' },

  headcountTitle: { en: "Today's headcount", sw: 'Idadi ya leo' },
  totalSuffix: { en: 'total', sw: 'jumla' },
  unknownSite: { en: 'Unknown site', sw: 'Tovuti isiyojulikana' },
  onShift: { en: 'on shift', sw: 'kazini' },
  noClockToday: {
    en: 'No clock-in events recorded today.',
    sw: 'Hakuna matukio ya kuingia yaliyorekodiwa leo.',
  },
  headcountError: {
    en: 'Could not load headcount data.',
    sw: 'Imeshindwa kupakia data ya idadi ya wafanyakazi.',
  },

  recentTitle: { en: 'Recent attendance', sw: 'Mahudhurio ya hivi karibuni' },
  attendanceError: {
    en: 'Could not load attendance history.',
    sw: 'Imeshindwa kupakia historia ya mahudhurio.',
  },
  emptyTitle: { en: 'No attendance records found.', sw: 'Hakuna rekodi za mahudhurio.' },
  emptyCta: {
    en: 'Ask Mr. Mwikila to show the roster',
    sw: 'Mwombe Bw. Mwikila aonyeshe orodha ya zamu',
  },

  colWorker: { en: 'Worker', sw: 'Mfanyakazi' },
  colSite: { en: 'Site', sw: 'Tovuti' },
  colDate: { en: 'Date', sw: 'Tarehe' },
  colClockIn: { en: 'Clock in', sw: 'Kuingia' },
  colClockOut: { en: 'Clock out', sw: 'Kutoka' },
  colEvent: { en: 'Event', sw: 'Tukio' },

  delegationNotePrefix: {
    en: 'Full per-worker details (contracts, payslips, disciplinary history) are managed via',
    sw: 'Maelezo kamili ya kila mfanyakazi (mikataba, malipo, historia ya kinidhamu) yanasimamiwa kupitia',
  },
  delegationNoteSuffix: {
    en: 'using the org-admin brain tools.',
    sw: 'kwa kutumia zana za akili za usimamizi wa shirika.',
  },
} as const;
