// Routes incoming deep links. The expo-share-intent extension opens the app
// with a URL containing `dataUrl=`; send those to Home, which reads the
// shared image via useShareIntentContext.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (path.includes('dataUrl=')) {
    return '/';
  }
  return path;
}
