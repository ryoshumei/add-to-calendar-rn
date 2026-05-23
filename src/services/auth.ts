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
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';

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

/**
 * Whether native Sign in with Apple is available (iOS 13+; false on Android,
 * web, and simulators without an Apple ID).
 */
export function isAppleSignInAvailable(): Promise<boolean> {
  return AppleAuthentication.isAvailableAsync();
}

/**
 * Native Sign in with Apple → Supabase session. Mirrors useGoogleSignIn but is
 * a one-shot async call (no expo-auth-session request/response hook needed).
 * After sign-in, best-effort links the Apple authorizationCode to the backend
 * so the account can be revoked at deletion. User cancellation is swallowed.
 */
export async function signInWithApple(): Promise<void> {
  try {
    const rawNonce = Crypto.randomUUID();
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce,
    );
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashedNonce,
    });
    if (!credential.identityToken) {
      throw new Error('No identity token returned from Apple');
    }
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      nonce: rawNonce,
    });
    if (error) throw error;

    // Best-effort: store the Apple refresh token for later revocation.
    const accessToken = data.session?.access_token;
    if (accessToken && credential.authorizationCode) {
      try {
        const linkRes = await fetch(CONFIG.EDGE_FUNCTIONS.APPLE_LINK, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            apikey: CONFIG.SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ authorizationCode: credential.authorizationCode }),
        });
        if (!linkRes.ok) {
          console.warn('apple-link failed (revocation unavailable):', linkRes.status);
        }
      } catch (linkErr) {
        console.warn('apple-link failed (revocation unavailable):', linkErr);
      }
    }
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return;
    throw e;
  }
}

/**
 * Permanently delete the signed-in user's account via the delete-account Edge
 * Function (revokes Apple tokens server-side, deletes data + auth user), then
 * signs out locally.
 */
export async function deleteAccount(accessToken: string): Promise<void> {
  const res = await fetch(CONFIG.EDGE_FUNCTIONS.DELETE_ACCOUNT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: CONFIG.SUPABASE_ANON_KEY,
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    let message = errText;
    try {
      message = JSON.parse(errText).error ?? errText;
    } catch {
      // not JSON
    }
    throw new Error(`Delete failed ${res.status}: ${message}`);
  }
  await supabase.auth.signOut();
}
