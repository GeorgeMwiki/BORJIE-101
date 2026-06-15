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
  const { lang } = useI18n()
  const isSw = lang === 'sw'
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title={isSw ? 'Shifti ya hivi karibuni' : 'Recent shift'}>
          <PlaceholderList
            items={[]}
            emptyLabel={isSw ? 'Hakuna shifti za hivi karibuni' : 'No recent shifts'}
          />
        </Section>
        <Section title={isSw ? 'Picha za leo' : "Today's photos"}>
          <View style={styles.row}>
            <PhotoSlot label={isSw ? 'Picha 1' : 'Photo 1'} />
            <PhotoSlot label={isSw ? 'Picha 2' : 'Photo 2'} />
            <PhotoSlot label={isSw ? 'Picha 3' : 'Photo 3'} />
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
