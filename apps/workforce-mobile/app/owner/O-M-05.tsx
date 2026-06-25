import { View, StyleSheet } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { PhotoSlot } from '../../src/components/StubBlocks'
import { RoleGuard } from '../../src/components/RoleGuard'
import { useI18n } from '../../src/i18n/useI18n'
import { spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-05'

export default function Screen(): JSX.Element {
  const { t } = useI18n()
  const copy = t.ownerScreens
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title={copy.recentShift}>
          <PlaceholderList items={[]} emptyLabel={copy.noRecentShifts} />
        </Section>
        <Section title={copy.todaysPhotos}>
          <View style={styles.row}>
            <PhotoSlot label={copy.photo1} />
            <PhotoSlot label={copy.photo2} />
            <PhotoSlot label={copy.photo3} />
          </View>
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm
  }
})
