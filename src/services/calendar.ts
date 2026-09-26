// Calendar service: add events to the device calendar (native) or open a
// Google Calendar template URL as a fallback. Works on iOS and Android.

import * as Calendar from 'expo-calendar';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { CONFIG } from '../config';
import type { CalendarEvent, EventRecurrence, RecurrenceDay } from './llm';
import { clearPreferredCalendar, getPreferredCalendar } from './storage';
import { deviceTimeZone, effectiveTimeZone, zonedTimeToDate } from './timezone';

export async function ensureCalendarPermission(): Promise<boolean> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (Platform.OS === 'ios') {
    await Calendar.requestRemindersPermissionsAsync().catch(() => undefined);
  }
  return status === 'granted';
}

export type WritableCalendar = {
  id: string;
  title: string;
  color: string;
  sourceName?: string;
};

/**
 * All calendars events can be saved to, for the Settings picker. Requests
 * calendar permission — call only from an explicit user action.
 */
export async function listWritableCalendars(): Promise<WritableCalendar[]> {
  const granted = await ensureCalendarPermission();
  if (!granted) throw new Error('Calendar permission denied');
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  return calendars
    .filter((c) => c.allowsModifications)
    .map((c) => ({
      id: c.id,
      title: c.title,
      color: c.color,
      sourceName: c.source?.name,
    }));
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

/**
 * The calendar events should be saved to: the user's chosen calendar from
 * Settings if it still exists and is writable, otherwise the device default.
 * A stale stored choice (calendar deleted / account unsynced) is cleared so
 * Settings reflects the actual fallback.
 */
async function getTargetCalendarId(): Promise<string | null> {
  const preferred = await getPreferredCalendar();
  if (preferred) {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const match = calendars.find((c) => c.id === preferred.id && c.allowsModifications);
    if (match) return match.id;
    await clearPreferredCalendar().catch(() => undefined);
  }
  return getDefaultCalendarId();
}

// RRULE BYDAY code → the day number expo-calendar's iOS native side decodes.
// CAUTION: the TS enum (Calendar.DayOfTheWeek) documents Sunday=1…Saturday=7,
// but the native record (ios/Records/RecurrenceRuleRecords.swift) decodes
// monday=1…sunday=7 — using the TS enum shifts every day by one (verified in
// the simulator: TU stored as WE in EventKit). Pass ISO numbers instead, and
// re-verify against the DB when upgrading expo-calendar.
const DAY_CODE_TO_ENUM: Record<RecurrenceDay, Calendar.DayOfTheWeek> = {
  MO: 1 as Calendar.DayOfTheWeek,
  TU: 2 as Calendar.DayOfTheWeek,
  WE: 3 as Calendar.DayOfTheWeek,
  TH: 4 as Calendar.DayOfTheWeek,
  FR: 5 as Calendar.DayOfTheWeek,
  SA: 6 as Calendar.DayOfTheWeek,
  SU: 7 as Calendar.DayOfTheWeek,
};

const FREQUENCY_TO_ENUM: Record<EventRecurrence['frequency'], Calendar.Frequency> = {
  daily: Calendar.Frequency.DAILY,
  weekly: Calendar.Frequency.WEEKLY,
  monthly: Calendar.Frequency.MONTHLY,
  yearly: Calendar.Frequency.YEARLY,
};

function toRecurrenceRule(recurrence: EventRecurrence, timeZone: string): Calendar.RecurrenceRule {
  const rule: Calendar.RecurrenceRule = {
    frequency: FREQUENCY_TO_ENUM[recurrence.frequency],
  };
  if (recurrence.interval) rule.interval = recurrence.interval;
  if (recurrence.until) {
    // End of the "until" day, so the last occurrence is included.
    rule.endDate = zonedTimeToDate(`${recurrence.until}T23:59:59`, timeZone);
  }
  // daysOfTheWeek is iOS-only in expo-calendar; on Android weekly recurrence
  // still anchors to the start date's weekday, which covers the common case.
  if (Platform.OS === 'ios' && recurrence.daysOfWeek?.length) {
    rule.daysOfTheWeek = recurrence.daysOfWeek.map((d) => ({
      dayOfTheWeek: DAY_CODE_TO_ENUM[d],
    }));
  }
  return rule;
}

export async function addEventToDeviceCalendar(event: CalendarEvent): Promise<string> {
  const granted = await ensureCalendarPermission();
  if (!granted) throw new Error('Calendar permission denied');
  const calendarId = await getTargetCalendarId();
  if (!calendarId) throw new Error('No writable calendar found on this device');

  const timeZone = await effectiveTimeZone();

  // Event times are wall-clock in the effective zone (the LLM was given "now"
  // there), so resolve them in that zone — EventKit's timeZone field only
  // labels the event, it doesn't reinterpret the instant.
  const id = await Calendar.createEventAsync(calendarId, {
    title: event.title,
    notes: event.description,
    location: event.location,
    startDate: zonedTimeToDate(event.startTime, timeZone),
    endDate: zonedTimeToDate(event.endTime, timeZone),
    timeZone,
    ...(event.recurrence
      ? { recurrenceRule: toRecurrenceRule(event.recurrence, timeZone) }
      : {}),
  });
  return id;
}

// Wall-clock time in `timeZone` → Google's UTC stamp (20260927T230000Z).
function toGoogleUtc(localDateTime: string, timeZone: string): string {
  return zonedTimeToDate(localDateTime, timeZone)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function buildRRule(recurrence: EventRecurrence, timeZone: string): string {
  const parts = [`FREQ=${recurrence.frequency.toUpperCase()}`];
  if (recurrence.interval) parts.push(`INTERVAL=${recurrence.interval}`);
  if (recurrence.frequency === 'weekly' && recurrence.daysOfWeek?.length) {
    parts.push(`BYDAY=${recurrence.daysOfWeek.join(',')}`);
  }
  if (recurrence.until) {
    // Date-time UNTIL at the end of the "until" day in the event's zone (as
    // UTC) so the last date stays inclusive and matches the native path; a
    // bare date would be read as the 00:00 boundary and could drop the final
    // occurrence, and a UTC end of day is hours off for most users.
    parts.push(`UNTIL=${toGoogleUtc(`${recurrence.until}T23:59:59`, timeZone)}`);
  }
  return `RRULE:${parts.join(';')}`;
}

export function buildGoogleCalendarUrl(event: CalendarEvent, timeZone?: string): string {
  // ctz only sets the editor's display zone; the Z stamps fix the instant.
  const tz = timeZone ?? deviceTimeZone();
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title ?? '',
    dates: `${toGoogleUtc(event.startTime, tz)}/${toGoogleUtc(event.endTime, tz)}`,
    details: event.description ?? '',
    location: event.location ?? '',
  });
  if (event.recurrence) params.append('recur', buildRRule(event.recurrence, tz));
  if (timeZone) params.append('ctz', timeZone);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export async function openGoogleCalendar(event: CalendarEvent): Promise<void> {
  const url = buildGoogleCalendarUrl(event, await effectiveTimeZone());
  // The Google Calendar mobile app intercepts calendar.google.com links
  // (universal/app links) but its TEMPLATE handler drops the recur param,
  // turning recurring events into one-offs (verified on-device, v1.0.3).
  // Recurring events therefore bounce through a trampoline page on an
  // unclaimed domain: it opens in the user's default browser (already
  // signed into Google for most people) and forwards to the web editor,
  // which honors recur — redirects don't re-trigger universal links.
  // The target rides in the #fragment so it never reaches the page's server.
  if (event.recurrence && Platform.OS !== 'web') {
    await Linking.openURL(`${CONFIG.GCAL_RECUR_REDIRECT}#${encodeURIComponent(url)}`);
    return;
  }
  await Linking.openURL(url);
}
