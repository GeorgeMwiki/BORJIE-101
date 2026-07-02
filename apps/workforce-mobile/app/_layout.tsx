import { useMemo } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../src/auth/AuthProvider'
import { createQueryClient } from '../src/api/queryClient'
import { BackgroundSyncMount } from '../src/sync/BackgroundSyncMount'
import { PilotErrorBoundary } from '../src/components/PilotErrorBoundary'
import { colors } from '../src/theme/colors'
import { ThemeProvider } from '../src/theme/ThemeProvider'
import { EventStreamMount } from '../src/lib/notifications/EventStreamMount'
import { SuperpowersBootstrap } from '../src/superpowers'

export default function RootLayout(): JSX.Element {
  const queryClient = useMemo(() => createQueryClient(), [])
  return (
    <PilotErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface }}>
      <SafeAreaProvider>
        <ThemeProvider defaultTheme="dark">
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <BackgroundSyncMount />
            <EventStreamMount />
            <SuperpowersBootstrap />
            <StatusBar style="light" backgroundColor={colors.earth700} />
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: colors.earth700 },
                headerTintColor: colors.textInverse,
                contentStyle: { backgroundColor: colors.surface },
                headerTitleStyle: { fontWeight: '700' }
              }}
            >
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding" options={{ headerShown: false }} />
              <Stack.Screen
                name="onboarding/role"
                options={{ title: 'Borjie', headerShown: false }}
              />
              <Stack.Screen name="onboarding/welcome" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding/phone" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding/identity" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding/role-detect" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding/site" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding/certifications" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding/biometric" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding/safety" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding/calibration" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding/done" options={{ headerShown: false }} />
              <Stack.Screen name="photo-advisor" options={{ headerShown: false }} />
              {/* Owner (O-M-*) and worker (W-M-*) catalogue screens live in
                  app/owner/* and app/worker/*. Expo-router already routes them
                  by file path; declaring the folders here pins headerShown:false
                  so the screen's own ScreenShell chrome renders instead of a
                  flashed default header. Per-screen role gating is enforced
                  inside each screen via <RoleGuard> against src/roles/access.ts. */}
              <Stack.Screen name="owner/O-M-01" options={{ headerShown: false }} />
              <Stack.Screen name="owner/O-M-02" options={{ headerShown: false }} />
              <Stack.Screen name="owner/O-M-03" options={{ headerShown: false }} />
              <Stack.Screen name="owner/O-M-04" options={{ headerShown: false }} />
              <Stack.Screen name="owner/O-M-05" options={{ headerShown: false }} />
              <Stack.Screen name="owner/O-M-06" options={{ headerShown: false }} />
              <Stack.Screen name="owner/O-M-07" options={{ headerShown: false }} />
              <Stack.Screen name="owner/O-M-08" options={{ headerShown: false }} />
              <Stack.Screen name="owner/O-M-09" options={{ headerShown: false }} />
              <Stack.Screen name="owner/O-M-10" options={{ headerShown: false }} />
              <Stack.Screen name="owner/O-M-11" options={{ headerShown: false }} />
              <Stack.Screen name="owner/O-M-12" options={{ headerShown: false }} />
              <Stack.Screen name="owner/O-M-13" options={{ headerShown: false }} />
              <Stack.Screen name="owner/O-M-14" options={{ headerShown: false }} />
              <Stack.Screen name="owner/O-M-15" options={{ headerShown: false }} />
              <Stack.Screen name="owner/O-M-16" options={{ headerShown: false }} />
              <Stack.Screen name="owner/O-M-17" options={{ headerShown: false }} />
              <Stack.Screen name="owner/O-M-18" options={{ headerShown: false }} />
              <Stack.Screen name="owner/O-M-19" options={{ headerShown: false }} />
              <Stack.Screen name="owner/O-M-20" options={{ headerShown: false }} />
              <Stack.Screen name="owner/O-M-21" options={{ headerShown: false }} />
              <Stack.Screen name="owner/O-M-22" options={{ headerShown: false }} />
              <Stack.Screen name="owner/O-M-23" options={{ headerShown: false }} />
              <Stack.Screen name="owner/O-M-24" options={{ headerShown: false }} />
              <Stack.Screen name="owner/O-M-25" options={{ headerShown: false }} />
              <Stack.Screen name="owner/cockpit/index" options={{ headerShown: false }} />
              <Stack.Screen name="worker/W-M-01" options={{ headerShown: false }} />
              <Stack.Screen name="worker/W-M-02" options={{ headerShown: false }} />
              <Stack.Screen name="worker/W-M-03" options={{ headerShown: false }} />
              <Stack.Screen name="worker/W-M-04" options={{ headerShown: false }} />
              <Stack.Screen name="worker/W-M-05" options={{ headerShown: false }} />
              <Stack.Screen name="worker/W-M-06" options={{ headerShown: false }} />
              <Stack.Screen name="worker/W-M-07" options={{ headerShown: false }} />
              <Stack.Screen name="worker/W-M-08" options={{ headerShown: false }} />
              <Stack.Screen name="worker/W-M-09" options={{ headerShown: false }} />
              <Stack.Screen name="worker/W-M-10" options={{ headerShown: false }} />
              <Stack.Screen name="worker/W-M-11" options={{ headerShown: false }} />
              <Stack.Screen name="worker/W-M-12" options={{ headerShown: false }} />
              <Stack.Screen name="worker/W-M-13" options={{ headerShown: false }} />
              <Stack.Screen name="worker/W-M-14" options={{ headerShown: false }} />
              <Stack.Screen name="worker/W-M-15" options={{ headerShown: false }} />
              <Stack.Screen name="worker/W-M-16" options={{ headerShown: false }} />
              <Stack.Screen name="worker/W-M-17" options={{ headerShown: false }} />
              <Stack.Screen name="worker/W-M-18" options={{ headerShown: false }} />
              <Stack.Screen name="worker/W-M-19" options={{ headerShown: false }} />
              <Stack.Screen name="worker/W-M-20" options={{ headerShown: false }} />
              <Stack.Screen name="worker/W-M-21" options={{ headerShown: false }} />
              <Stack.Screen name="worker/W-M-22" options={{ headerShown: false }} />
              <Stack.Screen
                name="documents/[id]"
                options={{ title: 'Hati hai', headerShown: true }}
              />
              <Stack.Screen
                name="notifications/index"
                options={{ title: 'Arifa', headerShown: true }}
              />
            </Stack>
          </AuthProvider>
        </QueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
    </PilotErrorBoundary>
  )
}
