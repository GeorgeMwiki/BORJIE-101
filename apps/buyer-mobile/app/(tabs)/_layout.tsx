import { Tabs } from 'expo-router'
import { Text } from 'react-native'
import { useTranslation } from '@/hooks/useTranslation'
import { tokens } from '@/ui-litfin'

function TabIcon({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={{ color, fontSize: 18, fontWeight: '700' }}>{glyph}</Text>
}

export default function TabsLayout() {
  const { t } = useTranslation()
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: tokens.color.gold,
        tabBarInactiveTintColor: tokens.color.textMuted,
        tabBarStyle: {
          backgroundColor: tokens.color.bgRaised,
          borderTopColor: tokens.color.border,
          borderTopWidth: 1
        },
        tabBarLabelStyle: { fontWeight: '600', fontSize: 11, letterSpacing: 0.3 },
        headerStyle: { backgroundColor: tokens.color.bgSurface },
        headerTitleStyle: { color: tokens.color.textPrimary, fontWeight: '700' },
        headerTintColor: tokens.color.gold
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: t('tabs.dashboard'),
          tabBarIcon: ({ color }) => <TabIcon glyph="H" color={color} />
        }}
      />
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
        name="documents-intel"
        options={{
          title: 'Live docs',
          tabBarIcon: ({ color }) => <TabIcon glyph="L" color={color} />
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
