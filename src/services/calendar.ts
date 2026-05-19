// Calendar service: add events to the device calendar (native) or open a
// Google Calendar template URL as a fallback. Works on iOS and Android.

import * as Calendar from 'expo-calendar';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import type { CalendarEvent } from './llm';

function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export async function ensureCalendarPermission(): Promise<boolean> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (Platform.OS === 'ios') {
    await Calendar.requestRemindersPermissionsAsync().catch(() => undefined);
  }
  return status === 'granted';
}

async function getDefaultCalendarId(): Promise<string | null> {
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  if (!calendars.length) return null;

  if (Platform.OS === 'ios') {
    const def = await Calendar.getDefaultCalendarAsync().catch(() => null);
    if (def?.id) return def.id;
  }
  const writable = calendars.find((c) => c.allowsModifications) ?? calendars[0];
  return writable?.id ?? null;
}

export async function addEventToDeviceCalendar(event: CalendarEvent): Promise<string> {
  const granted = await ensureCalendarPermission();
  if (!granted) throw new Error('Calendar permission denied');
  const calendarId = await getDefaultCalendarId();
  if (!calendarId) throw new Error('No writable calendar found on this device');

  const timeZone = deviceTimeZone();

  const id = await Calendar.createEventAsync(calendarId, {
    title: event.title,
    notes: event.description,
    location: event.location,
    startDate: new Date(event.startTime),
    endDate: new Date(event.endTime),
    timeZone,
  });
  return id;
}

export function buildGoogleCalendarUrl(event: CalendarEvent): string {
  const fmt = (s: string) =>
    new Date(s).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title ?? '',
    dates: `${fmt(event.startTime)}/${fmt(event.endTime)}`,
    details: event.description ?? '',
    location: event.location ?? '',
  });
  const tz = deviceTimeZone();
  if (tz) params.append('ctz', tz);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export async function openGoogleCalendar(event: CalendarEvent): Promise<void> {
  const url = buildGoogleCalendarUrl(event);
  await Linking.openURL(url);
}
