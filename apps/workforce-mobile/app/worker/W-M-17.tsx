import { StyleSheet, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { PhotoSlot } from '../../src/components/StubBlocks'
import { RoleGuard } from '../../src/components/RoleGuard'
import { spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-17'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Pakia picha">
          <View style={styles.row}>
            <PhotoSlot label="Picha 1" />
            <PhotoSlot label="Picha 2" />
          </View>
        </Section>
        <Section title="Alama">
          <PlaceholderList
            items={[
              { id: 'gps', primary: 'GPS', secondary: '-3.4287, 32.9183' },
              { id: 'tag', primary: 'Tag', secondary: 'Pit 2 / wall east' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm }
})
