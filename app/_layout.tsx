import { Stack } from 'expo-router';
import { ShareIntentProvider } from 'expo-share-intent';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useColorScheme } from 'react-native';
import { useTheme } from '../src/ui/theme';

export default function RootLayout() {
  const scheme = useColorScheme();
  const theme = useTheme();

  return (
    <ShareIntentProvider options={{ resetOnBackground: true }}>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.groupedBackground }}>
        <SafeAreaProvider>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          <Stack
            screenOptions={{
              headerLargeTitle: true,
              headerTransparent: false,
              headerStyle: { backgroundColor: theme.groupedBackground },
              headerTintColor: theme.systemBlue,
              headerTitleStyle: { color: theme.label },
              headerLargeTitleStyle: { color: theme.label },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: theme.groupedBackground },
            }}
          >
            <Stack.Screen name="index" options={{ title: 'Add to Calendar' }} />
            <Stack.Screen
              name="settings"
              options={{ title: 'Settings', presentation: 'modal', headerLargeTitle: false }}
            />
          </Stack>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ShareIntentProvider>
  );
}
