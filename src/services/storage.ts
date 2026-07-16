// API key storage: SecureStore on device, AsyncStorage fallback on web.

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const KEY = 'openai_api_key';

export async function getApiKey(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem(KEY);
  }
  return SecureStore.getItemAsync(KEY);
}

export async function setApiKey(value: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(KEY, value);
    return;
  }
  await SecureStore.setItemAsync(KEY, value);
}

export async function clearApiKey(): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(KEY);
    return;
  }
  await SecureStore.deleteItemAsync(KEY);
}

// ─── Preferred target calendar (not a secret — plain AsyncStorage) ─────────
// Title is stored alongside the id so Settings can show the current choice
// without triggering a calendar-permission prompt.

const PREFERRED_CALENDAR_KEY = 'preferred_calendar';

export type PreferredCalendar = { id: string; title: string };

export async function getPreferredCalendar(): Promise<PreferredCalendar | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFERRED_CALENDAR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.id === 'string' && typeof parsed?.title === 'string') {
      return parsed as PreferredCalendar;
    }
    return null;
  } catch {
    return null;
  }
}

export async function setPreferredCalendar(value: PreferredCalendar): Promise<void> {
  await AsyncStorage.setItem(PREFERRED_CALENDAR_KEY, JSON.stringify(value));
}

export async function clearPreferredCalendar(): Promise<void> {
  await AsyncStorage.removeItem(PREFERRED_CALENDAR_KEY);
}
