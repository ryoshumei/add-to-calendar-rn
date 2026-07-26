// LLM service: extracts calendar events from text or images.
//
// Two modes (matches the Chrome extension):
//   1. Authenticated → call shared Supabase Edge Function (no API key needed,
//      backend uses its own OpenAI key, 50 req/month per user).
//   2. Bring-your-own-key → call OpenAI directly from the device.
//
// Image input works in both modes: signed-in users hit the process-image
// Edge Function; BYOK users call OpenAI vision directly from the device.

import * as FileSystem from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { CONFIG } from '../config';
import { effectiveTimeZone, nowInTimeZone } from './timezone';

// RRULE BYDAY two-letter codes, also what the LLM is asked to emit.
export type RecurrenceDay = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';

export type EventRecurrence = {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number; // every N days/weeks/months/years, default 1
  until?: string; // YYYY-MM-DD (inclusive last date)
  daysOfWeek?: RecurrenceDay[]; // weekly only
};

export type CalendarEvent = {
  title: string;
  description?: string;
  startTime: string; // YYYY-MM-DDTHH:mm:ss
  endTime: string;
  location?: string;
  recurrence?: EventRecurrence;
};

export type UsageInfo = {
  usageCount: number;
  limit: number;
  yearMonth: string;
};

export type ExtractionResult = {
  events: CalendarEvent[];
  usage?: UsageInfo;
};

const MODEL_TEXT = 'gpt-4.1-mini';
const MODEL_VISION = 'gpt-4.1-mini';
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

function buildSystemPrompt(currentDateTime: string): string {
  return `You are a JSON API that extracts event details from text or images. Return ONLY a raw JSON object with an "events" array containing one or more event objects:
{
  "events": [
    {
      "title": "event title",
      "description": "brief description",
      "startTime": "YYYY-MM-DDTHH:mm:ss",
      "endTime": "YYYY-MM-DDTHH:mm:ss",
      "location": "location if mentioned, include online link if available",
      "recurrence": { "frequency": "daily|weekly|monthly|yearly", "interval": 1, "until": "YYYY-MM-DD", "daysOfWeek": ["MO"] }
    }
  ]
}
Current time is: ${currentDateTime}
For relative dates, use the current time as reference.
If no specific time mentioned, assume 10:00 AM for 1 hour.
endTime must be strictly AFTER startTime — when an event crosses midnight (e.g. starts 23:12), endTime uses the NEXT day's date.
Include "recurrence" ONLY when the source clearly describes a repeating event ("every Tuesday", "weekly standup", "monthly meetup", "daily at 9"). A single dated occurrence ("this Tuesday", "next Friday", "on July 30") is NOT recurring — never infer recurrence from the event type alone. Omit it entirely for one-off events. In "recurrence": "interval" defaults to 1 (use 2 for "every other week" etc.); include "until" only when an end date is stated; include "daysOfWeek" (two-letter codes MO TU WE TH FR SA SU) only for weekly recurrence. startTime/endTime must be the FIRST occurrence.
If the source contains multiple events, extract ALL of them as separate objects in the array.
If only one event is found, still return it inside the events array.
DO NOT include any markdown formatting, code blocks, or extra text.
ONLY return the JSON object itself.`;
}

// "Now" in the user's effective time zone (Settings override or device zone),
// with the zone name spelled out so the LLM anchors relative dates correctly.
async function nowDateTimeString(): Promise<string> {
  return nowInTimeZone(await effectiveTimeZone());
}

const RECURRENCE_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
const RECURRENCE_DAYS: RecurrenceDay[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/**
 * Validate a model-supplied recurrence object field by field; anything
 * malformed degrades to "no recurrence" rather than a bad calendar write.
 */
function sanitizeRecurrence(raw: unknown): EventRecurrence | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const freqInput = typeof r.frequency === 'string' ? r.frequency.toLowerCase() : '';
  const frequency = RECURRENCE_FREQUENCIES.find((f) => f === freqInput);
  if (!frequency) return undefined;

  const out: EventRecurrence = { frequency };
  const interval = Number(r.interval);
  if (Number.isInteger(interval) && interval >= 2 && interval <= 99) {
    out.interval = interval;
  }
  // Strict YYYY-MM-DD only: consumers build "<until>T23:59:59" dates and
  // RRULE UNTIL strings from it, so looser formats new Date() would accept
  // ("2026/08/01", "August 1, 2026") must be dropped, not passed through.
  if (
    typeof r.until === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(r.until) &&
    !Number.isNaN(new Date(`${r.until}T00:00:00`).getTime())
  ) {
    out.until = r.until;
  }
  if (frequency === 'weekly' && Array.isArray(r.daysOfWeek)) {
    const days = r.daysOfWeek
      .map((d) => String(d).toUpperCase())
      .filter((d): d is RecurrenceDay => (RECURRENCE_DAYS as string[]).includes(d));
    if (days.length) out.daysOfWeek = days;
  }
  return out;
}

const LOCAL_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Repair model output where endTime is not after startTime — the common
 * cause is an event crossing midnight (a 23:12 receipt + default 1h
 * duration → 00:12 emitted on the SAME date). Roll endTime forward a day;
 * anything still nonsensical becomes a 1-hour event. Wall-clock math is
 * anchored in UTC ("Z") so device timezone/DST can never skew it.
 * Mirrors the backend's parse-event-response.ts.
 */
function normalizeEventTimes(e: CalendarEvent): CalendarEvent {
  if (!LOCAL_DATETIME_RE.test(e.startTime) || !LOCAL_DATETIME_RE.test(e.endTime)) return e;
  const start = new Date(`${e.startTime}Z`).getTime();
  const end = new Date(`${e.endTime}Z`).getTime();
  if (end > start) return e;
  // Midnight crossing needs a strictly earlier end — an EQUAL end is a
  // zero-length event, which becomes 1 hour, not 24.
  const endNextDay = end + DAY_MS;
  const repaired = end < start && endNextDay > start ? endNextDay : start + HOUR_MS;
  return { ...e, endTime: new Date(repaired).toISOString().slice(0, 19) };
}

/** Normalize events from any source (BYOK or backend): drop invalid
 * recurrence, repair inverted start/end times. */
function sanitizeEvents(events: CalendarEvent[]): CalendarEvent[] {
  return events
    .filter((e): e is CalendarEvent => !!e && typeof e === 'object')
    .map((e) => {
      const recurrence = sanitizeRecurrence((e as { recurrence?: unknown }).recurrence);
      const { recurrence: _raw, ...rest } = e;
      return normalizeEventTimes(recurrence ? { ...rest, recurrence } : rest);
    });
}

function parseLLMJson(content: string): CalendarEvent[] {
  const trimmed = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const parsed = JSON.parse(trimmed);
  if (Array.isArray(parsed?.events)) return sanitizeEvents(parsed.events as CalendarEvent[]);
  if (parsed?.title && parsed?.startTime && parsed?.endTime) {
    return sanitizeEvents([parsed as CalendarEvent]);
  }
  throw new Error('LLM response missing events array');
}

// ─── Backend (Supabase Edge Function) ─────────────────────────────────────

export async function extractEventsFromTextViaBackend(
  accessToken: string,
  text: string,
): Promise<ExtractionResult> {
  const res = await fetch(CONFIG.EDGE_FUNCTIONS.PROCESS_TEXT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'X-Extension-Version': CONFIG.APP.VERSION,
      apikey: CONFIG.SUPABASE_ANON_KEY,
    },
    // currentDateTime tells the backend the user's local time (with
    // timezone) so relative dates ("tomorrow") resolve against the user's
    // clock, not the Edge Function's UTC clock.
    body: JSON.stringify({ selectedText: text, currentDateTime: await nowDateTimeString() }),
  });

  if (!res.ok) {
    const errText = await res.text();
    let message = errText;
    try {
      const j = JSON.parse(errText);
      message = j.error ?? errText;
    } catch {
      // not JSON
    }
    throw new Error(`Backend error ${res.status}: ${message}`);
  }
  const data = await res.json();
  // Backend may return { eventDetails: { events: [...] }, usage } or
  // { events: [...], usage }. Accept both.
  const events: CalendarEvent[] =
    data?.eventDetails?.events ??
    data?.events ??
    (data?.eventDetails ? [data.eventDetails] : []);
  return { events: sanitizeEvents(events), usage: data?.usage };
}

/**
 * Current-month usage without consuming a request — lets the home screen
 * show remaining credits on launch. Best-effort: returns null on any
 * failure so it can never block the UI.
 */
export async function fetchUsageViaBackend(accessToken: string): Promise<UsageInfo | null> {
  try {
    const res = await fetch(CONFIG.EDGE_FUNCTIONS.GET_USAGE, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Extension-Version': CONFIG.APP.VERSION,
        apikey: CONFIG.SUPABASE_ANON_KEY,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const usage = data?.usage;
    if (
      usage &&
      typeof usage.usageCount === 'number' &&
      typeof usage.limit === 'number' &&
      typeof usage.yearMonth === 'string'
    ) {
      return usage as UsageInfo;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Backend image extraction (resize → base64 → process-image) ───────────

/**
 * Resize an image to 1600px wide (aspect ratio preserved) and JPEG-compress
 * it, to keep the upload payload (and OpenAI token cost) small. Returns a new
 * local file URI in the cache.
 */
async function resizeForUpload(uri: string): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: 1600 });
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
  return result.uri;
}

export async function extractEventsFromImageViaBackend(
  accessToken: string,
  imageUri: string,
): Promise<ExtractionResult> {
  const resizedUri = await resizeForUpload(imageUri);
  const base64 = await FileSystem.readAsStringAsync(resizedUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const dataUrl = `data:image/jpeg;base64,${base64}`;
  // The resized JPEG was only needed for encoding; drop it from the cache.
  FileSystem.deleteAsync(resizedUri, { idempotent: true }).catch(() => {});

  const res = await fetch(CONFIG.EDGE_FUNCTIONS.PROCESS_IMAGE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'X-Extension-Version': CONFIG.APP.VERSION,
      apikey: CONFIG.SUPABASE_ANON_KEY,
    },
    // Same as the text path: relative dates in the image resolve against
    // the user's clock, not the server's UTC clock.
    body: JSON.stringify({ image: dataUrl, currentDateTime: await nowDateTimeString() }),
  });

  if (!res.ok) {
    const errText = await res.text();
    let message = errText;
    try {
      const j = JSON.parse(errText);
      message = j.error ?? errText;
    } catch {
      // not JSON
    }
    throw new Error(`Backend error ${res.status}: ${message}`);
  }

  const data = await res.json();
  const events: CalendarEvent[] =
    data?.eventDetails?.events ??
    data?.events ??
    (data?.eventDetails ? [data.eventDetails] : []);
  return { events: sanitizeEvents(events), usage: data?.usage };
}

// ─── BYOK (direct OpenAI) ─────────────────────────────────────────────────

export async function extractEventsFromText(
  apiKey: string,
  text: string,
): Promise<CalendarEvent[]> {
  if (!apiKey) throw new Error('OpenAI API key is required');
  const currentDateTime = await nowDateTimeString();
  const body = {
    model: MODEL_TEXT,
    temperature: 0.3,
    top_p: 1,
    response_format: { type: 'json_object' as const },
    messages: [
      { role: 'system', content: buildSystemPrompt(currentDateTime) },
      { role: 'user', content: `Time: ${currentDateTime}\nText: ${text}` },
    ],
  };
  const res = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return parseLLMJson(data?.choices?.[0]?.message?.content ?? '');
}

export async function extractEventsFromImage(
  apiKey: string,
  imageUri: string,
): Promise<CalendarEvent[]> {
  if (!apiKey) throw new Error('OpenAI API key is required');
  const base64 = await FileSystem.readAsStringAsync(imageUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const mime = guessMime(imageUri);
  const dataUrl = `data:${mime};base64,${base64}`;
  const currentDateTime = await nowDateTimeString();

  const body = {
    model: MODEL_VISION,
    temperature: 0.3,
    top_p: 1,
    response_format: { type: 'json_object' as const },
    messages: [
      { role: 'system', content: buildSystemPrompt(currentDateTime) },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Time: ${currentDateTime}\nExtract all calendar events visible in this image (poster, screenshot, schedule, invitation, etc.).`,
          },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  };

  const res = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return parseLLMJson(data?.choices?.[0]?.message?.content ?? '');
}

function guessMime(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.heic') || lower.endsWith('.heif')) return 'image/heic';
  return 'image/jpeg';
}
