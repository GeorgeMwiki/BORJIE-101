import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-20'

interface DriverLetter {
  regNumber: string
  driverName: string
  truckType: string
  mineralType: string
  tonnage: number
  routeFrom: string
  routeTo: string
  validFromISO: string
  validToISO: string
  letterRef: string
}

const LETTER: DriverLetter = {
  regNumber: 'T-512-DKL',
  driverName: 'Juma Mwakasege',
  truckType: 'Howo 6×4 dumper',
  mineralType: 'Madini ya dhahabu (oxidized ore)',
  tonnage: 7.2,
  routeFrom: 'Pit 2, Geita',
  routeTo: 'Buyer warehouse, Mwanza',
  validFromISO: '2026-05-27T05:00:00Z',
  validToISO: '2026-05-28T18:00:00Z',
  letterRef: 'LV-2231'
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <DriverLetterView />
      </ScreenShell>
    </RoleGuard>
  )
}

function DriverLetterView(): JSX.Element {
  const [shared, setShared] = useState<boolean>(false)

  const share = useCallback((): void => {
    setShared(true)
  }, [])

  return (
    <View>
      <Section title="Barua ya dereva">
        <View style={styles.letter}>
          <View style={styles.letterHeader}>
            <Text style={styles.letterRef}>{LETTER.letterRef}</Text>
            <Text style={styles.letterStamp}>Borjie Mining Estate</Text>
          </View>
          <Text style={styles.letterTitle}>{LETTER.driverName}</Text>
          <Text style={styles.letterReg}>{LETTER.regNumber} · {LETTER.truckType}</Text>
          <View style={styles.divider} />
          <Row label="Bidhaa" value={LETTER.mineralType} />
          <Row label="Uzito" value={`${LETTER.tonnage.toFixed(1)} tani`} />
          <Row label="Kutoka" value={LETTER.routeFrom} />
          <Row label="Kwenda" value={LETTER.routeTo} />
        </View>
      </Section>
      <Section title="Uhalali wa barua">
        <Row label="Inaanza" value={formatDateTime(LETTER.validFromISO)} />
        <Row label="Inaisha" value={formatDateTime(LETTER.validToISO)} />
        <View style={styles.validBadge}>
          <Text style={styles.validBadgeLabel}>
            Inavalid kwa {hoursUntil(LETTER.validToISO)} hrs
          </Text>
        </View>
      </Section>
      <Section title="Shiriki na wengine">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Shiriki kwa WhatsApp"
          onPress={share}
          style={({ pressed }) => [styles.shareButton, pressed && styles.pressed]}
        >
          <Text style={styles.shareIcon}>↗</Text>
          <Text style={styles.shareLabel}>Shiriki kwa WhatsApp</Text>
        </Pressable>
        {shared ? (
          <Text style={styles.sharedNote}>
            Barua imeshirikishwa. Mpokeaji atapokea PDF na link ya uthibitisho.
          </Text>
        ) : null}
      </Section>
    </View>
  )
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  )
}

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return iso
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return `${day} ${time}`
}

function hoursUntil(iso: string): number {
  const target = new Date(iso).getTime()
  if (!Number.isFinite(target)) return 0
  return Math.max(0, Math.round((target - Date.now()) / (60 * 60 * 1000)))
}

const styles = StyleSheet.create({
  letter: {
    padding: spacing.lg,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.gold
  },
  letterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm
  },
  letterRef: {
    color: colors.goldDark,
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 1
  },
  letterStamp: {
    color: colors.textMuted,
    fontSize: fontSize.caption
  },
  letterTitle: {
    color: colors.text,
    fontSize: fontSize.h2,
    fontWeight: '700'
  },
  letterReg: {
    color: colors.earth700,
    fontSize: fontSize.body,
    marginTop: spacing.xs,
    fontWeight: '600'
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs
  },
  rowLabel: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  rowValue: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: spacing.md
  },
  validBadge: {
    marginTop: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.success,
    borderRadius: radius.md,
    alignItems: 'center'
  },
  validBadgeLabel: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: fontSize.body
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.success,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    gap: spacing.sm
  },
  pressed: {
    opacity: 0.85
  },
  shareIcon: {
    color: colors.textInverse,
    fontSize: fontSize.h3,
    fontWeight: '700'
  },
  shareLabel: {
    color: colors.textInverse,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  sharedNote: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontSize: fontSize.body,
    textAlign: 'center'
  }
})
