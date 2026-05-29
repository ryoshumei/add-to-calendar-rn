// In-app App Store / Play Store review prompt.
//
// We ask for a rating only at a genuine positive moment — right after the user
// has successfully added an event to their calendar — and we throttle hard so
// we never nag:
//   - Require a couple of successful adds first (proven value, not first run).
//   - Ask at most once per app version (matches Apple's own mental model: a
//     fresh prompt is reasonable after the user updates to a new version).
// Apple additionally caps the system prompt to ~3 times per 365 days and may
// silently show nothing, so requestReview() is best-effort by design.

import * as StoreReview from 'expo-store-review';
import * as Application from 'expo-application';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ADD_COUNT_KEY = 'review_add_count';
const PROMPTED_VERSION_KEY = 'review_prompted_version';

// Don't ask on the very first add — wait until the user has clearly found the
// app useful at least once before.
const MIN_ADDS_BEFORE_PROMPT = 2;

/**
 * Record a successful calendar add and, if the user looks engaged and we
 * haven't already asked on this app version, request a store review.
 *
 * Best-effort and fire-and-forget: it never throws, so callers can `void` it
 * without affecting the core add-to-calendar flow.
 */
export async function recordSuccessfulAddAndMaybeAskForReview(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(ADD_COUNT_KEY);
    const count = (parseInt(raw ?? '0', 10) || 0) + 1;
    await AsyncStorage.setItem(ADD_COUNT_KEY, String(count));

    if (count < MIN_ADDS_BEFORE_PROMPT) return;

    const currentVersion = Application.nativeApplicationVersion ?? 'unknown';
    const promptedVersion = await AsyncStorage.getItem(PROMPTED_VERSION_KEY);
    if (promptedVersion === currentVersion) return;

    if (!(await StoreReview.isAvailableAsync())) return;

    // Record the attempt before asking: the OS decides whether to actually show
    // the prompt, and we should not retry within the same version regardless.
    await AsyncStorage.setItem(PROMPTED_VERSION_KEY, currentVersion);
    await StoreReview.requestReview();
  } catch {
    // Never let review prompting interfere with adding events.
  }
}
