// Google sign-in via expo-auth-session, exchanged for a Supabase session.
// Mirrors the Chrome extension flow: Google ID token → Supabase verifies →
// app receives an access token usable against Edge Functions.

import * as AuthSession from 'expo-auth-session';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { CONFIG } from '../config';
import type { Session, User } from '@supabase/supabase-js';

WebBrowser.maybeCompleteAuthSession();

export type AuthState = {
  user: User | null;
  session: Session | null;
  loading: boolean;
};

/**
 * React hook: returns the current Supabase auth state and re-renders on
 * sign-in / sign-out.
 */
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setState({
        user: data.session?.user ?? null,
        session: data.session,
        loading: false,
      });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({
        user: session?.user ?? null,
        session,
        loading: false,
      });
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}

/**
 * React hook returning a `signIn` function that triggers Google sign-in and
 * hands the ID token to Supabase. The hook must be called inside a component.
 */
export function useGoogleSignIn() {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: CONFIG.GOOGLE.IOS_CLIENT_ID || undefined,
    androidClientId: CONFIG.GOOGLE.ANDROID_CLIENT_ID || undefined,
    clientId: CONFIG.GOOGLE.WEB_CLIENT_ID || undefined,
  });

  useEffect(() => {
    const idToken = response?.type === 'success' ? response.params?.id_token : null;
    if (!idToken) return;
    void supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
  }, [response]);

  return {
    ready: !!request,
    signIn: () => promptAsync(),
    lastError:
      response?.type === 'error'
        ? response.error?.message ?? 'Google sign-in failed'
        : null,
  };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/**
 * Returns the redirect URI we expect Google to accept. Useful for surfacing
 * in setup docs.
 */
export function getRedirectUri(): string {
  return AuthSession.makeRedirectUri({ scheme: 'addtocalendar' });
}
