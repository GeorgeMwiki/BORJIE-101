import { useMemo } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { QueryClientProvider } from '@tanstack/react-query'
import { colors } from '@/theme/colors'
import { createQueryClient } from '@/api/queryClient'
import { ToastProvider } from '@/components/Toast'
import { ThemeProvider } from '@/theme/ThemeProvider'
import { EventStreamMount } from '@/lib/notifications/EventStreamMount'
import { SuperpowersBootstrap } from '@/superpowers'

export default function RootLayout() {
  // useMemo guarantees the QueryClient is created once per app lifetime
  // (Fast Refresh keeps the module alive, so a top-level `const` would
  // also work, but useMemo plays nicer with strict mode in dev).
  const queryClient = useMemo(() => createQueryClient(), [])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <ThemeProvider defaultTheme="dark">
          <ToastProvider>
            <EventStreamMount />
            <SuperpowersBootstrap />
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
              <Stack.Screen name="documents-intel/[id]" options={{ title: 'Live doc' }} />
              <Stack.Screen name="kyc/verify" options={{ title: 'KYC status' }} />
              <Stack.Screen name="profile/notifications" options={{ title: 'Notifications' }} />
              <Stack.Screen name="chat" options={{ title: 'Chat' }} />
            </Stack>
          </ToastProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  )
}
