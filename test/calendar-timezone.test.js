// Regression tests for time zones in calendar writes.
//
// The LLM returns offset-less wall-clock times ("2026-09-27T19:00:00") in the
// *effective* zone — the Settings override, else the device zone — because
// that's the "now" it was given. These tests load the real
// src/services/{calendar,timezone,storage}.ts (transpiled with the repo's
// TypeScript, native modules stubbed below) and check the instants handed to
// expo-calendar and put in the Google Calendar URL, under several emulated
// device zones. No simulator needed: `npm test`.

const { beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const RealDateTimeFormat = Intl.DateTimeFormat;

// ─── Native module stubs ──────────────────────────────────────────────────

const asyncStorage = new Map();
const createdEvents = [];
const openedUrls = [];

const STUBS = {
  'react-native': { Platform: { OS: 'ios' } },
  'expo-secure-store': {},
  '@react-native-async-storage/async-storage': {
    __esModule: true,
    default: {
      getItem: async (key) => asyncStorage.get(key) ?? null,
      setItem: async (key, value) => void asyncStorage.set(key, value),
      removeItem: async (key) => void asyncStorage.delete(key),
    },
  },
  'expo-linking': { openURL: async (url) => void openedUrls.push(url) },
  'expo-calendar': {
    EntityTypes: { EVENT: 'event' },
    Frequency: { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' },
    requestCalendarPermissionsAsync: async () => ({ status: 'granted' }),
    requestRemindersPermissionsAsync: async () => ({ status: 'granted' }),
    getCalendarsAsync: async () => [{ id: 'cal-1', title: 'Home', allowsModifications: true }],
    getDefaultCalendarAsync: async () => ({ id: 'cal-1' }),
    createEventAsync: async (_calendarId, details) => {
      createdEvents.push(details);
      return 'event-1';
    },
  },
};

// Loads a .ts module as CommonJS; relative imports load the real files,
// everything else must be stubbed above.
const loaded = new Map();
function loadTs(file) {
  if (loaded.has(file)) return loaded.get(file).exports;
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const mod = { exports: {} };
  loaded.set(file, mod);
  const requireFromFile = (spec) => {
    if (spec in STUBS) return STUBS[spec];
    if (spec.startsWith('.')) return loadTs(path.resolve(path.dirname(file), `${spec}.ts`));
    throw new Error(`${path.relative(ROOT, file)} imports "${spec}"; add a stub for it`);
  };
  vm.runInThisContext(`(function (exports, require, module) {${outputText}\n})`, {
    filename: file,
  })(mod.exports, requireFromFile, mod);
  return mod.exports;
}

const calendar = loadTs(path.join(ROOT, 'src/services/calendar.ts'));
const storage = loadTs(path.join(ROOT, 'src/services/storage.ts'));
const { zonedTimeToDate } = loadTs(path.join(ROOT, 'src/services/timezone.ts'));

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Emulates the phone's zone (Node re-reads TZ on assignment) and the Settings override. */
async function setZones(device, override) {
  process.env.TZ = device;
  if (override) await storage.setPreferredTimeZone(override);
  else await storage.clearPreferredTimeZone();
}

/** What "Add to Calendar" hands to expo-calendar. */
async function nativeAdd(event) {
  createdEvents.length = 0;
  await calendar.addEventToDeviceCalendar(event);
  return createdEvents[0];
}

async function nativeStart(startTime) {
  return (await nativeAdd({ title: 'x', startTime, endTime: startTime })).startDate.toISOString();
}

/** The Google Calendar URL "Open in Google" opens (recurring events go via a redirect page). */
async function googleUrl(event) {
  openedUrls.length = 0;
  await calendar.openGoogleCalendar(event);
  const [url] = openedUrls;
  const hash = url.indexOf('#');
  return new URL(hash === -1 ? url : decodeURIComponent(url.slice(hash + 1)));
}

const googleStamp = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

const DINNER = { title: 'Dinner', startTime: '2026-09-27T19:00:00', endTime: '2026-09-27T20:00:00' };
const STANDUP = {
  title: 'Standup',
  startTime: '2026-09-29T20:00:00',
  endTime: '2026-09-29T20:30:00',
  recurrence: { frequency: 'weekly', until: '2026-10-27', daysOfWeek: ['TU'] },
};

// ─── Calendar writes ──────────────────────────────────────────────────────

for (const device of ['Asia/Tokyo', 'America/Los_Angeles', 'Europe/Berlin']) {
  describe(`device zone ${device}`, () => {
    it('saves native events at the override zone’s wall-clock time', async () => {
      await setZones(device, 'America/New_York');
      const ny = await nativeAdd(DINNER);
      assert.equal(ny.startDate.toISOString(), '2026-09-27T23:00:00.000Z'); // 7 PM EDT
      assert.equal(ny.endDate.toISOString(), '2026-09-28T00:00:00.000Z');
      assert.equal(ny.timeZone, 'America/New_York');

      await setZones(device, 'Asia/Tokyo');
      assert.equal(await nativeStart(DINNER.startTime), '2026-09-27T10:00:00.000Z'); // 7 PM JST
    });

    it('puts the override zone’s instant in the Google Calendar URL', async () => {
      await setZones(device, 'America/New_York');
      const url = await googleUrl(DINNER);
      assert.equal(url.searchParams.get('dates'), '20260927T230000Z/20260928T000000Z');
      assert.equal(url.searchParams.get('ctz'), 'America/New_York');
    });

    it('keeps device-local times when there is no override', async () => {
      await setZones(device, null);
      const added = await nativeAdd(DINNER);
      assert.equal(added.startDate.getTime(), new Date(DINNER.startTime).getTime());
      assert.equal(added.timeZone, device);
      const url = await googleUrl(DINNER);
      const expected = `${googleStamp(new Date(DINNER.startTime))}/${googleStamp(new Date(DINNER.endTime))}`;
      assert.equal(url.searchParams.get('dates'), expected);
    });

    it('handles DST changes in the override zone', async () => {
      // New York springs forward 2026-03-08 02:00 and falls back 2026-11-01 02:00.
      await setZones(device, 'America/New_York');
      assert.equal(await nativeStart('2026-03-08T01:30:00'), '2026-03-08T06:30:00.000Z'); // EST
      assert.equal(await nativeStart('2026-03-08T03:30:00'), '2026-03-08T07:30:00.000Z'); // EDT
      // 02:30 doesn't exist that night; like new Date(), shift forward to 03:30 EDT.
      assert.equal(await nativeStart('2026-03-08T02:30:00'), '2026-03-08T07:30:00.000Z');
      assert.equal(await nativeStart('2026-11-01T03:00:00'), '2026-11-01T08:00:00.000Z'); // EST
    });

    it('ends a recurrence at the end of its "until" day in the effective zone', async () => {
      await setZones(device, 'America/New_York');
      const added = await nativeAdd(STANDUP);
      assert.equal(added.recurrenceRule.endDate.toISOString(), '2026-10-28T03:59:59.000Z');
      // Keeps the last Tuesday 8 PM EDT (00:00Z Oct 28) that a UTC end of day dropped.
      assert.equal(
        (await googleUrl(STANDUP)).searchParams.get('recur'),
        'RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261028T035959Z',
      );

      await setZones(device, 'Asia/Tokyo');
      assert.equal(
        (await googleUrl(STANDUP)).searchParams.get('recur'),
        'RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261027T145959Z',
      );

      await setZones(device, null);
      assert.equal(
        (await googleUrl(STANDUP)).searchParams.get('recur'),
        `RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=${googleStamp(new Date('2026-10-27T23:59:59'))}`,
      );
    });
  });
}

// ─── zonedTimeToDate ──────────────────────────────────────────────────────

// Half-hour and 45-minute offsets, a 30-minute DST shift (Lord Howe),
// southern-hemisphere DST (Santiago, Chatham).
const SWEEP_ZONES = [
  'America/New_York',
  'Europe/London',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'America/St_Johns',
  'Australia/Lord_Howe',
  'Pacific/Chatham',
  'America/Santiago',
];

const referenceFormatters = new Map();
function wallClockIn(date, timeZone) {
  let fmt = referenceFormatters.get(timeZone);
  if (!fmt) {
    fmt = new RealDateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    referenceFormatters.set(timeZone, fmt);
  }
  const p = Object.fromEntries(fmt.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

const HOUR = 3_600_000;
// A wall clock expressed as if it were UTC, so wall times can be stepped through.
const wallMs = (t, tz) => Date.parse(`${wallClockIn(new Date(t), tz)}Z`);

/** Wall times in 2026 to probe in `tz`: one every `stepMinutes`, plus 15-minute steps around each offset change. */
function wallTimesToProbe(tz, stepMinutes) {
  const start = Date.UTC(2026, 0, 1);
  const end = Date.UTC(2027, 0, 1);
  const walls = [];
  for (let w = start; w < end; w += stepMinutes * 60_000) walls.push(w);
  for (let t = start; t < end; t += 6 * HOUR) {
    const [from, to] = [wallMs(t, tz), wallMs(t + 6 * HOUR, tz)];
    if (to - from === 6 * HOUR) continue; // no offset change in this window
    for (let w = from - 2 * HOUR; w <= to + 2 * HOUR; w += 15 * 60_000) walls.push(w);
  }
  return walls.map((w) => new Date(w).toISOString().slice(0, 19));
}

/** Probed wall times that don't round-trip, other than DST-gap times shifted forward. */
function roundTripFailures(stepMinutes) {
  const failures = [];
  for (const tz of SWEEP_ZONES) {
    for (const wall of wallTimesToProbe(tz, stepMinutes)) {
      const got = zonedTimeToDate(wall, tz);
      const back = wallClockIn(got, tz);
      if (back === wall) continue;
      const hourBefore = wallClockIn(new Date(got.getTime() - HOUR), tz);
      if (back > wall && hourBefore < wall) continue; // nonexistent wall time, shifted forward
      failures.push(`${tz} ${wall} -> ${got.toISOString()} (reads ${back})`);
    }
  }
  return failures;
}

describe('zonedTimeToDate', () => {
  beforeEach(() => {
    process.env.TZ = 'Asia/Tokyo';
  });

  it('leaves strings that carry their own offset alone', () => {
    const tz = 'America/New_York';
    assert.equal(zonedTimeToDate('2026-09-27T19:00:00+09:00', tz).toISOString(), '2026-09-27T10:00:00.000Z');
    assert.equal(zonedTimeToDate('2026-09-27T19:00:00Z', tz).toISOString(), '2026-09-27T19:00:00.000Z');
  });

  it('accepts wall times without seconds', () => {
    assert.equal(
      zonedTimeToDate('2026-09-27T19:00', 'America/New_York').toISOString(),
      '2026-09-27T23:00:00.000Z',
    );
  });

  it('falls back to device-local parsing for an unknown zone', () => {
    const wall = '2026-09-27T19:00:00';
    assert.equal(zonedTimeToDate(wall, 'Mars/Olympus_Mons').getTime(), new Date(wall).getTime());
  });

  it('round-trips wall times across unusual zones', () => {
    assert.deepEqual(roundTripFailures(24 * 60 + 97), []);
  });

  // Hermes on iOS formats via NSDateFormatter; tolerate clock-style variants.
  it('reads 12-hour and "24:00" formatter output', () => {
    const variants = {
      '12-hour clock': function (locale, { hourCycle, ...options } = {}) {
        return new RealDateTimeFormat(locale, { ...options, hour12: true });
      },
      'h24 clock': function (locale, options = {}) {
        return new RealDateTimeFormat(locale, { ...options, hourCycle: 'h24' });
      },
    };
    try {
      for (const [name, variant] of Object.entries(variants)) {
        Intl.DateTimeFormat = variant;
        assert.deepEqual(roundTripFailures(3 * 24 * 60 + 97), [], name);
      }
    } finally {
      Intl.DateTimeFormat = RealDateTimeFormat;
    }
  });

  it('falls back to device-local parsing when formatter output is unreadable', () => {
    const wall = '2026-09-27T19:00:00';
    try {
      Intl.DateTimeFormat = function (_locale, options) {
        return new RealDateTimeFormat('de-DE', options); // "27.9.2026, 19:00:00"
      };
      assert.equal(zonedTimeToDate(wall, 'America/New_York').getTime(), new Date(wall).getTime());
    } finally {
      Intl.DateTimeFormat = RealDateTimeFormat;
    }
  });
});
