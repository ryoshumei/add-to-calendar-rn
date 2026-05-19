// Public configuration shared with the Chrome extension. Anon key is safe to
// expose — it's the public Supabase client key. Edge Functions enforce auth.
//
// Forking? Replace SUPABASE_URL, SUPABASE_ANON_KEY, and EDGE_FUNCTIONS.PROCESS_TEXT
// with values from your own Supabase project, and deploy the process-text
// Edge Function there (see the sibling Chrome extension repo for source).

export const CONFIG = {
  SUPABASE_URL: 'https://pahcnlwgtghsctbnedhx.supabase.co',
  SUPABASE_ANON_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhaGNubHdndGdoc2N0Ym5lZGh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc1Njk0NTcsImV4cCI6MjA3MzE0NTQ1N30.PmsrghVvCAvJW3dPFeqRvsDeulzZQyN8-VXn_lRZr14',
  EDGE_FUNCTIONS: {
    PROCESS_TEXT:
      'https://pahcnlwgtghsctbnedhx.supabase.co/functions/v1/process-text',
  },
  APP: {
    NAME: 'Add to Calendar',
    VERSION: '1.0.0',
  },
  // Google OAuth client IDs. Get these from Google Cloud Console.
  // iOS client ID is needed for native Sign-In. Web client ID is required
  // because Supabase verifies the ID token against the web client's audience.
  GOOGLE: {
    IOS_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '',
    WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
    ANDROID_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? '',
  },
} as const;
