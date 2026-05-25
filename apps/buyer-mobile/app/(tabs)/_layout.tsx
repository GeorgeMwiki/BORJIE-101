import { Tabs } from 'expo-router'
import { Text } from 'react-native'
import { useTranslation } from '@/hooks/useTranslation'
import { colors } from '@/theme/colors'

function TabIcon({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={{ color, fontSize: 18, fontWeight: '600' }}>{glyph}</Text>
}

export default function TabsLayout() {
  const { t } = useTranslation()
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.forest,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.line },
        headerStyle: { backgroundColor: colors.bone },
        headerTintColor: colors.ink
      }}
    >
      <Tabs.Screen
        name="marketplace"
        options={{
          title: t('tabs.marketplace'),
          tabBarIcon: ({ color }) => <TabIcon glyph="M" color={color} />
        }}
      />
      <Tabs.Screen
        name="bids"
        options={{
          title: t('tabs.bids'),
          tabBarIcon: ({ color }) => <TabIcon glyph="B" color={color} />
        }}
      />
      <Tabs.Screen
        name="documents"
        options={{
          title: t('tabs.documents'),
          tabBarIcon: ({ color }) => <TabIcon glyph="D" color={color} />
        }}
      />
      <Tabs.Screen
        name="kyc"
        options={{
          title: t('tabs.kyc'),
          tabBarIcon: ({ color }) => <TabIcon glyph="K" color={color} />
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
          tabBarIcon: ({ color }) => <TabIcon glyph="P" color={color} />
        }}
      />
    </Tabs>
  )
}
