import { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { clearApiKey, getApiKey, setApiKey } from '../src/services/storage';
import * as AppleAuthentication from 'expo-apple-authentication';
import Svg, { Path } from 'react-native-svg';
import {
  deleteAccount,
  isAppleSignInAvailable,
  signInWithApple,
  signOut,
  useAuth,
  useGoogleSignIn,
} from '../src/services/auth';
import { CONFIG } from '../src/config';
import { radius, spacing, useTheme } from '../src/ui/theme';

export default function Settings() {
  const theme = useTheme();
  const auth = useAuth();
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const colorScheme = useColorScheme();
  const [appleAvailable, setAppleAvailable] = useState(false);
  useEffect(() => {
    isAppleSignInAvailable().then(setAppleAvailable);
  }, []);

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete account',
      'This permanently deletes your account and all your data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const token = auth.session?.access_token;
              if (!token) throw new Error('No active session');
              await deleteAccount(token);
            } catch (e) {
              Alert.alert('Delete failed', String((e as Error).message ?? e));
            }
          },
        },
      ],
    );
  };

  useEffect(() => {
    getApiKey().then((k) => {
      setSaved(k);
      if (k) setKey(k);
    });
  }, []);

  const handleSaveKey = async () => {
    const trimmed = key.trim();
    if (!trimmed) return Alert.alert('Empty key', 'Please enter a value.');
    await setApiKey(trimmed);
    setSaved(trimmed);
    setEditing(false);
    Alert.alert('Saved', 'API key saved to secure storage.');
  };

  const handleClearKey = async () => {
    await clearApiKey();
    setKey('');
    setSaved(null);
    setEditing(false);
  };

  const googleConfigured =
    !!CONFIG.GOOGLE.IOS_CLIENT_ID || !!CONFIG.GOOGLE.WEB_CLIENT_ID;

  return (
    <ScrollView
      style={{ backgroundColor: theme.groupedBackground }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl * 2 }}
    >
      <SectionHeader theme={theme}>ACCOUNT</SectionHeader>
      {auth.user ? (
        <Group theme={theme}>
          <Row theme={theme}>
            <Text style={{ fontSize: 17, color: theme.label, flex: 1 }}>Signed in</Text>
            <Text style={{ fontSize: 15, color: theme.secondaryLabel }} numberOfLines={1}>
              {auth.user.email}
            </Text>
          </Row>
          <Hairline theme={theme} />
          <Pressable
            onPress={async () => {
              await signOut();
            }}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.fill }]}
          >
            <Text style={{ color: theme.systemBlue, fontSize: 17, flex: 1 }}>Sign out</Text>
          </Pressable>
          <Hairline theme={theme} />
          <Pressable
            onPress={handleDeleteAccount}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.fill }]}
          >
            <Text style={{ color: theme.systemRed, fontSize: 17, flex: 1 }}>Delete account</Text>
          </Pressable>
        </Group>
      ) : appleAvailable || googleConfigured ? (
        <View style={{ gap: spacing.sm }}>
          {appleAvailable && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={
                colorScheme === 'dark'
                  ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                  : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={radius.md}
              style={{ width: '100%', height: 48 }}
              onPress={async () => {
                try {
                  await signInWithApple();
                } catch (e) {
                  Alert.alert('Apple sign-in failed', String((e as Error).message ?? e));
                }
              }}
            />
          )}
          {googleConfigured && <GoogleSignInButton />}
        </View>
      ) : (
        <Group theme={theme}>
          <View style={[styles.row, { opacity: 0.5 }]}>
            <Text style={{ fontSize: 22, marginRight: spacing.sm }}>🔐</Text>
            <Text style={{ fontSize: 17, color: theme.label, flex: 1 }}>
              Sign-in not configured
            </Text>
          </View>
        </Group>
      )}
      <Footnote theme={theme}>
        {auth.user
          ? 'Calendar event extraction uses the shared backend (50 requests/month). Add an OpenAI key below to use it instead.'
          : googleConfigured
          ? 'Sign in to use the shared backend — no API key needed (50 requests/month free).'
          : 'Google sign-in needs an iOS / Web client ID. See README to configure.'}
      </Footnote>

      <SectionHeader theme={theme}>OPENAI API KEY</SectionHeader>
      <Group theme={theme}>
        {saved && !editing ? (
          <>
            <Row theme={theme}>
              <Text style={{ fontSize: 17, color: theme.label, flex: 1 }}>Key</Text>
              <Text style={{ fontSize: 15, color: theme.secondaryLabel }}>
                sk-…{saved.slice(-4)}
              </Text>
            </Row>
            <Hairline theme={theme} />
            <Pressable
              onPress={() => setEditing(true)}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.fill }]}
            >
              <Text style={{ color: theme.systemBlue, fontSize: 17, flex: 1 }}>Edit</Text>
            </Pressable>
            <Hairline theme={theme} />
            <Pressable
              onPress={handleClearKey}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.fill }]}
            >
              <Text style={{ color: theme.systemRed, fontSize: 17, flex: 1 }}>Remove key</Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={{ padding: spacing.md, gap: spacing.sm }}>
              <TextInput
                style={[
                  styles.input,
                  {
                    color: theme.label,
                    backgroundColor: theme.groupedBackground,
                    borderColor: theme.separator,
                  },
                ]}
                placeholder="sk-..."
                placeholderTextColor={theme.tertiaryLabel}
                value={key}
                onChangeText={setKey}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Pressable
                  style={[styles.pillBtn, { backgroundColor: theme.systemBlue }]}
                  onPress={handleSaveKey}
                >
                  <Text style={{ color: '#fff', fontWeight: '600' }}>Save</Text>
                </Pressable>
                {saved && (
                  <Pressable
                    style={[styles.pillBtnOutline, { borderColor: theme.systemBlue }]}
                    onPress={() => {
                      setKey(saved);
                      setEditing(false);
                    }}
                  >
                    <Text style={{ color: theme.systemBlue, fontWeight: '600' }}>Cancel</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </>
        )}
      </Group>
      <Footnote theme={theme}>
        Stored in Keychain (iOS) / Keystore (Android). Sent directly to OpenAI; never
        leaves the device otherwise. Required for image extraction.
        {'  '}
        <Text
          onPress={() => Linking.openURL('https://platform.openai.com/api-keys')}
          style={{ color: theme.systemBlue }}
        >
          Get a key →
        </Text>
      </Footnote>

      <SectionHeader theme={theme}>ABOUT</SectionHeader>
      <Group theme={theme}>
        <Row theme={theme}>
          <Text style={{ fontSize: 17, color: theme.label, flex: 1 }}>Version</Text>
          <Text style={{ fontSize: 15, color: theme.secondaryLabel }}>{CONFIG.APP.VERSION}</Text>
        </Row>
        <Hairline theme={theme} />
        <Pressable
          onPress={() => Linking.openURL('https://openai.com/policies/usage-policies/')}
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.fill }]}
        >
          <Text style={{ fontSize: 17, color: theme.label, flex: 1 }}>OpenAI usage policy</Text>
          <Text style={{ color: theme.tertiaryLabel, fontSize: 17 }}>›</Text>
        </Pressable>
      </Group>
    </ScrollView>
  );
}

// Official Google "G" mark (multicolor), per Google branding guidelines.
function GoogleGLogo({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
    </Svg>
  );
}

// Branded "Sign in with Google" button, sized to match the native Apple button.
function GoogleSignInButton() {
  const google = useGoogleSignIn();
  const dark = useColorScheme() === 'dark';
  const bg = dark ? '#131314' : '#FFFFFF';
  const borderColor = dark ? '#8E918F' : '#747775';
  const textColor = dark ? '#E3E3E3' : '#1F1F1F';
  return (
    <Pressable
      disabled={!google.ready}
      onPress={() => google.signIn()}
      style={({ pressed }) => [
        styles.providerBtn,
        { backgroundColor: bg, borderColor, opacity: !google.ready ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      <GoogleGLogo size={18} />
      <Text style={{ color: textColor, fontSize: 17, fontWeight: '600', marginLeft: spacing.sm }}>
        Sign in with Google
      </Text>
    </Pressable>
  );
}

function SectionHeader({
  children,
  theme,
}: {
  children: React.ReactNode;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Text
      style={{
        color: theme.secondaryLabel,
        fontSize: 13,
        marginTop: spacing.xl,
        marginBottom: spacing.xs,
        marginLeft: spacing.md,
        letterSpacing: 0.4,
      }}
    >
      {children}
    </Text>
  );
}

function Group({
  children,
  theme,
}: {
  children: React.ReactNode;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View
      style={{
        backgroundColor: theme.card,
        borderRadius: radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.separator,
        overflow: 'hidden',
      }}
    >
      {children}
    </View>
  );
}

function Row({
  children,
  theme,
}: {
  children: React.ReactNode;
  theme: ReturnType<typeof useTheme>;
}) {
  return <View style={styles.row}>{children}</View>;
}

function Hairline({ theme }: { theme: ReturnType<typeof useTheme> }) {
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.separator,
        marginLeft: spacing.md,
      }}
    />
  );
}

function Footnote({
  children,
  theme,
}: {
  children: React.ReactNode;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Text
      style={{
        color: theme.secondaryLabel,
        fontSize: 13,
        marginTop: spacing.sm,
        marginHorizontal: spacing.md,
        lineHeight: 18,
      }}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 44,
  },
  providerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: 16,
  },
  pillBtn: { flex: 1, paddingVertical: 10, borderRadius: 20, alignItems: 'center' },
  pillBtnOutline: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
  },
});
