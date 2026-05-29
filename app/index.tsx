import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import {
  extractEventsFromImage,
  extractEventsFromImageViaBackend,
  extractEventsFromText,
  extractEventsFromTextViaBackend,
  type CalendarEvent,
  type UsageInfo,
} from '../src/services/llm';
import { getApiKey } from '../src/services/storage';
import {
  addEventToDeviceCalendar,
  openGoogleCalendar,
} from '../src/services/calendar';
import { recordSuccessfulAddAndMaybeAskForReview } from '../src/services/review';
import { useAuth } from '../src/services/auth';
import { radius, spacing, useTheme } from '../src/ui/theme';

export default function Home() {
  const theme = useTheme();
  const router = useRouter();
  const auth = useAuth();
  const [text, setText] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKeyState] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);

  const refreshKey = useCallback(async () => {
    setApiKeyState(await getApiKey());
  }, []);

  useEffect(() => {
    refreshKey();
  }, [refreshKey]);

  useFocusEffect(
    useCallback(() => {
      refreshKey();
    }, [refreshKey]),
  );

  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  useEffect(() => {
    if (!hasShareIntent) return;
    const file = shareIntent.files?.[0];
    if (file?.mimeType?.startsWith('image/')) {
      setImageUri(file.path);
    }
    resetShareIntent();
  }, [hasShareIntent, shareIntent, resetShareIntent]);

  const canUseBackend = !!auth.session?.access_token;
  const canUseBYOK = !!apiKey;
  const canExtractText = canUseBackend || canUseBYOK;
  const canExtractImage = canUseBYOK || canUseBackend;

  const pickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('Permission needed', 'Photo library access is required.');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (!result.canceled && result.assets?.[0]?.uri) setImageUri(result.assets[0].uri);
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert('Permission needed', 'Camera access is required.');
    const result = await ImagePicker.launchCameraAsync({ quality: 0.85 });
    if (!result.canceled && result.assets?.[0]?.uri) setImageUri(result.assets[0].uri);
  };

  const handleExtract = async () => {
    if (!text.trim() && !imageUri) {
      return Alert.alert('Nothing to extract', 'Enter text or pick an image first.');
    }
    if (imageUri && !canExtractImage) {
      return Alert.alert(
        'Sign in or add a key',
        'Image extraction needs sign-in (free, 50/month) or your own OpenAI key. Set up in Settings.',
      );
    }
    if (text.trim() && !canExtractText) {
      return Alert.alert(
        'Sign in or add a key',
        'Sign in (free, 50/month) or add an OpenAI API key — both in Settings.',
      );
    }
    setLoading(true);
    setEvents([]);
    try {
      const collected: CalendarEvent[] = [];
      if (text.trim()) {
        if (canUseBYOK) {
          collected.push(...(await extractEventsFromText(apiKey!, text.trim())));
        } else if (canUseBackend) {
          const result = await extractEventsFromTextViaBackend(
            auth.session!.access_token,
            text.trim(),
          );
          collected.push(...result.events);
          if (result.usage) setUsage(result.usage);
        }
      }
      if (imageUri) {
        if (canUseBYOK) {
          collected.push(...(await extractEventsFromImage(apiKey!, imageUri)));
        } else if (canUseBackend) {
          const result = await extractEventsFromImageViaBackend(
            auth.session!.access_token,
            imageUri,
          );
          collected.push(...result.events);
          if (result.usage) setUsage(result.usage);
        }
      }
      if (!collected.length) Alert.alert('No events found', 'The model did not return any events.');
      setEvents(collected);
    } catch (e: unknown) {
      Alert.alert('Extraction failed', String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  };

  const handleAddNative = async (event: CalendarEvent) => {
    try {
      await addEventToDeviceCalendar(event);
      // Show success first; ask for a review only after the user dismisses it,
      // so the two native dialogs never collide.
      Alert.alert('Added', `"${event.title}" added to your calendar.`, [
        {
          text: 'OK',
          onPress: () => {
            void recordSuccessfulAddAndMaybeAskForReview();
          },
        },
      ]);
    } catch (e: unknown) {
      Alert.alert('Failed', String((e as Error).message ?? e));
    }
  };

  const handleOpenGoogle = async (event: CalendarEvent) => {
    try {
      await openGoogleCalendar(event);
    } catch (e: unknown) {
      Alert.alert('Failed', String((e as Error).message ?? e));
    }
  };

  const clearAll = () => {
    setText('');
    setImageUri(null);
    setEvents([]);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: theme.groupedBackground }}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: spacing.xl * 2 }}
        keyboardShouldPersistTaps="handled"
      >
        <StatusBanner
          auth={auth}
          apiKey={apiKey}
          usage={usage}
          onSettings={() => router.push('/settings')}
        />

        <Section title="EVENT TEXT" theme={theme}>
          <TextInput
            style={[
              styles.textarea,
              { color: theme.label, backgroundColor: theme.card, borderColor: theme.separator },
            ]}
            placeholder="e.g. Team meeting tomorrow at 2pm in Conference Room A"
            placeholderTextColor={theme.tertiaryLabel}
            multiline
            value={text}
            onChangeText={setText}
          />
        </Section>

        <Section title="IMAGE" theme={theme}>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <PhotoSourceCard label="Choose photo" onPress={pickFromLibrary} theme={theme}>
              <PhotoIcon color={theme.systemBlue} />
            </PhotoSourceCard>
            <PhotoSourceCard label="Take photo" onPress={takePhoto} theme={theme}>
              <CameraIcon color={theme.systemBlue} />
            </PhotoSourceCard>
          </View>
          {imageUri && (
            <View
              style={[
                styles.card,
                {
                  backgroundColor: theme.card,
                  borderColor: theme.separator,
                  marginTop: spacing.md,
                },
              ]}
            >
              <View style={{ padding: spacing.md, gap: spacing.sm }}>
                <Image source={{ uri: imageUri }} style={styles.preview} resizeMode="cover" />
                <Pressable onPress={() => setImageUri(null)}>
                  <Text style={{ color: theme.systemRed, fontSize: 15 }}>Remove image</Text>
                </Pressable>
              </View>
            </View>
          )}
        </Section>

        <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.md }}>
          <Pressable
            style={[
              styles.primaryBtn,
              {
                backgroundColor: theme.systemBlue,
                opacity: loading || (!text.trim() && !imageUri) ? 0.5 : 1,
              },
            ]}
            onPress={handleExtract}
            disabled={loading || (!text.trim() && !imageUri)}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Extract events</Text>
            )}
          </Pressable>
        </View>

        {events.length > 0 && (
          <Section title={`${events.length} EVENT${events.length > 1 ? 'S' : ''}`} theme={theme}>
            <View
              style={[
                styles.card,
                { backgroundColor: theme.card, borderColor: theme.separator },
              ]}
            >
              {events.map((event, idx) => (
                <View key={`${event.title}-${idx}`}>
                  {idx > 0 && <Separator theme={theme} />}
                  <EventCard
                    event={event}
                    theme={theme}
                    onAddNative={() => handleAddNative(event)}
                    onOpenGoogle={() => handleOpenGoogle(event)}
                  />
                </View>
              ))}
            </View>
          </Section>
        )}

        {(text || imageUri || events.length > 0) && (
          <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.md }}>
            <Pressable onPress={clearAll} style={{ alignSelf: 'center', padding: spacing.sm }}>
              <Text style={{ color: theme.systemRed, fontSize: 15 }}>Clear all</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function StatusBanner({
  auth,
  apiKey,
  usage,
  onSettings,
}: {
  auth: ReturnType<typeof useAuth>;
  apiKey: string | null;
  usage: UsageInfo | null;
  onSettings: () => void;
}) {
  const theme = useTheme();
  const signedIn = !!auth.user;
  const email = auth.user?.email;

  let message: string;
  let tone: 'info' | 'warn' = 'info';
  if (signedIn && apiKey) {
    message = `Signed in as ${email} · using your OpenAI key`;
  } else if (signedIn) {
    const remaining = usage ? usage.limit - usage.usageCount : null;
    message = `Signed in as ${email}${
      remaining !== null ? ` · ${remaining}/${usage!.limit} requests left this month` : ''
    }`;
  } else if (apiKey) {
    message = `Using your OpenAI key (sk…${apiKey.slice(-4)})`;
  } else {
    message = 'Sign in or add an OpenAI key in Settings';
    tone = 'warn';
  }

  return (
    <Pressable onPress={onSettings}>
      <View
        style={[
          styles.banner,
          {
            backgroundColor: tone === 'warn' ? '#FFF4E5' : theme.card,
            borderColor: tone === 'warn' ? '#FFB020' : theme.separator,
          },
        ]}
      >
        <Text
          style={{
            color: tone === 'warn' ? '#9A5500' : theme.secondaryLabel,
            fontSize: 13,
            flex: 1,
          }}
        >
          {message}
        </Text>
        <Text style={{ color: theme.systemBlue, fontSize: 13, fontWeight: '600' }}>
          {signedIn || apiKey ? 'Manage' : 'Set up'}
        </Text>
      </View>
    </Pressable>
  );
}

function Section({
  title,
  children,
  theme,
}: {
  title: string;
  children: React.ReactNode;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={{ marginTop: spacing.lg }}>
      <Text
        style={{
          color: theme.secondaryLabel,
          fontSize: 13,
          marginHorizontal: spacing.lg + spacing.xs,
          marginBottom: spacing.xs,
          letterSpacing: 0.4,
        }}
      >
        {title}
      </Text>
      <View style={{ paddingHorizontal: spacing.lg }}>{children}</View>
    </View>
  );
}

function PhotoSourceCard({
  label,
  onPress,
  theme,
  children,
}: {
  label: string;
  onPress: () => void;
  theme: ReturnType<typeof useTheme>;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.photoCard,
        { backgroundColor: theme.card, borderColor: theme.separator, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      {children}
      <Text style={{ color: theme.label, fontSize: 15, fontWeight: '500', marginTop: spacing.sm }}>
        {label}
      </Text>
    </Pressable>
  );
}

const ICON_STROKE = (color: string) => ({
  stroke: color,
  strokeWidth: 2,
  fill: 'none' as const,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

function PhotoIcon({ color, size = 28 }: { color: string; size?: number }) {
  const s = ICON_STROKE(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={3} y={3} width={18} height={18} rx={2} {...s} />
      <Circle cx={8.5} cy={8.5} r={1.5} {...s} />
      <Path d="M21 15l-5-5L5 21" {...s} />
    </Svg>
  );
}

function CameraIcon({ color, size = 28 }: { color: string; size?: number }) {
  const s = ICON_STROKE(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" {...s} />
      <Circle cx={12} cy={13} r={4} {...s} />
    </Svg>
  );
}

function Separator({ theme }: { theme: ReturnType<typeof useTheme> }) {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.separator, marginLeft: spacing.md }} />;
}

function EventCard({
  event,
  theme,
  onAddNative,
  onOpenGoogle,
}: {
  event: CalendarEvent;
  theme: ReturnType<typeof useTheme>;
  onAddNative: () => void;
  onOpenGoogle: () => void;
}) {
  return (
    <View style={{ padding: spacing.md, gap: spacing.xs }}>
      <Text style={{ fontSize: 17, fontWeight: '600', color: theme.label }}>{event.title}</Text>
      <Text style={{ fontSize: 13, color: theme.secondaryLabel }}>
        {formatRange(event.startTime, event.endTime)}
      </Text>
      {event.location ? (
        <Text style={{ fontSize: 13, color: theme.secondaryLabel }}>📍 {event.location}</Text>
      ) : null}
      {event.description ? (
        <Text style={{ fontSize: 14, color: theme.secondaryLabel, marginTop: spacing.xs }}>
          {event.description}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
        <Pressable
          onPress={onAddNative}
          style={[styles.pillBtn, { backgroundColor: theme.systemBlue }]}
        >
          <Text style={{ color: '#fff', fontWeight: '600', fontSize: 14 }}>Add to Calendar</Text>
        </Pressable>
        <Pressable
          onPress={onOpenGoogle}
          style={[styles.pillBtnOutline, { borderColor: theme.systemBlue }]}
        >
          <Text style={{ color: theme.systemBlue, fontWeight: '600', fontSize: 14 }}>
            Open in Google
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function formatRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const dateFmt: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  };
  const timeFmt: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) {
    return `${start.toLocaleDateString(undefined, dateFmt)} · ${start.toLocaleTimeString(
      undefined,
      timeFmt,
    )} – ${end.toLocaleTimeString(undefined, timeFmt)}`;
  }
  return `${start.toLocaleString(undefined, { ...dateFmt, ...timeFmt })} – ${end.toLocaleString(
    undefined,
    { ...dateFmt, ...timeFmt },
  )}`;
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  photoCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  textarea: {
    minHeight: 110,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  preview: {
    width: '100%',
    height: 200,
    borderRadius: radius.sm,
    backgroundColor: '#e5e7eb',
  },
  primaryBtn: {
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 17 },
  pillBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 20,
    alignItems: 'center',
  },
  pillBtnOutline: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
});
