import { Redirect } from 'expo-router'
import { isAuthenticated } from '@/auth/session'

export default function Index() {
  if (!isAuthenticated()) {
    return <Redirect href="/auth/login" />
  }
  return <Redirect href="/marketplace" />
}
