import { StyleSheet, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { PhotoSlot } from '../../src/components/StubBlocks'
import { RoleGuard } from '../../src/components/RoleGuard'
import { spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-09'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Gari na dereva">
          <PlaceholderList
            items={[
              { id: 'p', primary: 'Plate', secondary: 'T 123 ABC' },
              { id: 'd', primary: 'Dereva', secondary: 'Juma Mwita' }
            ]}
          />
        </Section>
        <Section title="Picha na video">
          <View style={styles.row}>
            <PhotoSlot label="Picha" />
            <PhotoSlot label="Video" />
          </View>
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm }
})
