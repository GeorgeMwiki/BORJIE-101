import { useMemo } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../src/auth/AuthProvider'
import { createQueryClient } from '../src/api/queryClient'
import { BackgroundSyncMount } from '../src/sync/BackgroundSyncMount'
import { colors } from '../src/theme/colors'

export default function RootLayout(): JSX.Element {
  const queryClient = useMemo(() => createQueryClient(), [])
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <BackgroundSyncMount />
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
              <Stack.Screen
                name="onboarding/role"
                options={{ title: 'Borjie', headerShown: false }}
              />
            </Stack>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
