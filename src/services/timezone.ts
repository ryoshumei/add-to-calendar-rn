// Time zone used everywhere a "clock" matters: the LLM's "current time"
// (so "tomorrow" resolves on the user's calendar day) and calendar writes.
// Defaults to the device zone; the user can override it in Settings.

import { getPreferredTimeZone } from './storage';

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The zone extraction and calendar writes should use: override or device. */
export async function effectiveTimeZone(): Promise<string> {
  const preferred = await getPreferredTimeZone();
  if (preferred && isValidTimeZone(preferred)) return preferred;
  return deviceTimeZone();
}

/** Human-readable "now" in the given zone — fed to the LLM as its clock. */
export function nowInTimeZone(tz: string): string {
  try {
    return new Date().toLocaleString('en-US', {
      timeZone: tz,
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'long',
    });
  } catch {
    return new Date().toString();
  }
}

const LOCAL_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

/**
 * The instant an offset-less wall-clock time ("2026-09-27T19:00:00", as the
 * LLM emits relative to the "now" it was given) denotes in `timeZone`.
 * `new Date(str)` reads it in the DEVICE zone instead, which shifts events by
 * the zone difference whenever Settings overrides the time zone.
 */
export function zonedTimeToDate(localDateTime: string, timeZone: string): Date {
  const m = LOCAL_DATE_TIME_RE.exec(localDateTime);
  // Device zone (no override) or a string with its own offset: the engine's
  // own parsing is already right.
  if (!m || timeZone === deviceTimeZone()) return new Date(localDateTime);
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
    // Guess with the offset at `wall`, then re-check it at the guess in case
    // a DST change lies in between (Luxon's fixOffset).
    const o1 = zoneOffsetAt(fmt, wall);
    const o2 = o1 === null ? null : zoneOffsetAt(fmt, wall - o1);
    if (o1 !== null && o2 !== null) {
      if (o1 === o2) return new Date(wall - o1);
      const o3 = zoneOffsetAt(fmt, wall - o2);
      if (o3 === o2) return new Date(wall - o2);
      // Wall time falls in a spring-forward gap: shift forward, like new Date().
      if (o3 !== null) return new Date(wall - Math.min(o2, o3));
    }
  } catch {
    // Unknown zone or no Intl support: fall back to device-local parsing.
  }
  return new Date(localDateTime);
}

/**
 * UTC offset (ms, east-positive) of `fmt`'s zone at instant `t`, read back
 * from its en-US output ("9/27/2026, 19:00:00"). Deliberately not
 * formatToParts(): Hermes on iOS doesn't implement it and aborts.
 */
function zoneOffsetAt(fmt: Intl.DateTimeFormat, t: number): number | null {
  const p = /(\d+)\/(\d+)\/(\d+),?\s+(\d+):(\d+):(\d+)\s*([AP]M)?/i.exec(
    fmt.format(new Date(t)).replace(/[\u200e\u200f]/g, ''),
  );
  if (!p) return null;
  let hour = +p[4] % 24; // some engines print midnight as 24
  if (p[7]) hour = (hour % 12) + (p[7].toUpperCase() === 'PM' ? 12 : 0);
  return Date.UTC(+p[3], +p[1] - 1, +p[2], hour, +p[5], +p[6]) - Math.floor(t / 1000) * 1000;
}

/**
 * Zones offered by the Settings picker. Prefers the full IANA list when the
 * runtime provides it (Intl.supportedValuesOf); otherwise a curated list.
 */
export function listTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  if (typeof intl.supportedValuesOf === 'function') {
    try {
      const zones = intl.supportedValuesOf('timeZone');
      if (zones.length) return zones;
    } catch {
      // fall through to the curated list
    }
  }
  return COMMON_TIME_ZONES;
}

const COMMON_TIME_ZONES = [
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Toronto',
  'America/Mexico_City',
  'America/Bogota',
  'America/Lima',
  'America/Santiago',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'Atlantic/Azores',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Athens',
  'Europe/Helsinki',
  'Europe/Istanbul',
  'Europe/Moscow',
  'Africa/Cairo',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Africa/Nairobi',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Taipei',
  'Asia/Manila',
  'Asia/Seoul',
  'Asia/Tokyo',
  'Australia/Perth',
  'Australia/Adelaide',
  'Australia/Sydney',
  'Australia/Brisbane',
  'Pacific/Auckland',
  'UTC',
];
