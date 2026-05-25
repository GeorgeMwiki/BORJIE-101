import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { colors } from '@/theme/colors'

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bone },
            headerTintColor: colors.ink,
            headerTitleStyle: { fontWeight: '600' },
            contentStyle: { backgroundColor: colors.bone }
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="auth/login" options={{ title: 'Borjie Buyers' }} />
          <Stack.Screen name="marketplace/[id]" options={{ title: 'Parcel' }} />
          <Stack.Screen name="bids/[id]" options={{ title: 'Bid' }} />
          <Stack.Screen name="documents/[id]" options={{ title: 'Contract' }} />
          <Stack.Screen name="kyc/verify" options={{ title: 'KYC status' }} />
          <Stack.Screen name="profile/notifications" options={{ title: 'Notifications' }} />
          <Stack.Screen name="chat" options={{ title: 'Chat' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
