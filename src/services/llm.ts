// LLM service: extracts calendar events from text or images.
//
// Two modes (matches the Chrome extension):
//   1. Authenticated → call shared Supabase Edge Function (no API key needed,
//      backend uses its own OpenAI key, 50 req/month per user).
//   2. Bring-your-own-key → call OpenAI directly from the device.
//
// Image input always uses BYOK for now — the shared Edge Function only
// accepts text. (A future /process-image function can mirror this client.)

import * as FileSystem from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { CONFIG } from '../config';

export type CalendarEvent = {
  title: string;
  description?: string;
  startTime: string; // YYYY-MM-DDTHH:mm:ss
  endTime: string;
  location?: string;
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
      "location": "location if mentioned, include online link if available"
    }
  ]
}
Current time is: ${currentDateTime}
For relative dates, use the current time as reference.
If no specific time mentioned, assume 10:00 AM for 1 hour.
If the source contains multiple events, extract ALL of them as separate objects in the array.
If only one event is found, still return it inside the events array.
DO NOT include any markdown formatting, code blocks, or extra text.
ONLY return the JSON object itself.`;
}

function nowDateTimeString(): string {
  return new Date().toString();
}

function parseLLMJson(content: string): CalendarEvent[] {
  const trimmed = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const parsed = JSON.parse(trimmed);
  if (Array.isArray(parsed?.events)) return parsed.events as CalendarEvent[];
  if (parsed?.title && parsed?.startTime && parsed?.endTime) {
    return [parsed as CalendarEvent];
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
    body: JSON.stringify({ selectedText: text }),
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
  return { events, usage: data?.usage };
}

// ─── Backend image extraction (resize → base64 → process-image) ───────────

/**
 * Resize an image to a max edge of 1600px and JPEG-compress it, to keep the
 * upload payload (and OpenAI token cost) small. Returns a new local file URI.
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

  const res = await fetch(CONFIG.EDGE_FUNCTIONS.PROCESS_IMAGE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'X-Extension-Version': CONFIG.APP.VERSION,
      apikey: CONFIG.SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ image: dataUrl }),
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
  return { events, usage: data?.usage };
}

// ─── BYOK (direct OpenAI) ─────────────────────────────────────────────────

export async function extractEventsFromText(
  apiKey: string,
  text: string,
): Promise<CalendarEvent[]> {
  if (!apiKey) throw new Error('OpenAI API key is required');
  const currentDateTime = nowDateTimeString();
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
  const currentDateTime = nowDateTimeString();

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
