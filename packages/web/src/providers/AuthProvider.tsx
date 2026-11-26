import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  SEED_MOCK_USERS,
  isUserRole,
  type UserRole,
  type UserSession,
} from '@app-icol/shared';
import { GasApiClient } from './GasApiClient';

export const MOCK_SESSION_STORAGE_KEY = 'app-icol:mock-session:v1';
export const GIS_TOKEN_STORAGE_KEY = 'app-icol:gis-session:v1';

interface StoredSessionState {
  status: 'authenticated' | 'signed_out';
  session?: UserSession;
}

export interface AuthContextValue {
  session: UserSession | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authError: string | null;
  isManager: boolean;
  isContributor: boolean;
  authMode: 'mock' | 'gis';
  roleStatusLabel: 'manager' | 'contributor' | 'unauthenticated';
  signInWithGoogleCredential: (idToken: string) => Promise<void>;
  switchMockProfile: (role: UserRole, customDisplayName?: string) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function resolveDefaultAuthMode(): 'mock' | 'gis' {
  const envMode = import.meta.env.VITE_AUTH_MODE;
  if (envMode === 'gis') return 'gis';
  return 'mock';
}

function hydrateInitialSession(authMode: 'mock' | 'gis'): UserSession | null {
  try {
    if (authMode === 'gis') {
      const raw = window.localStorage.getItem(GIS_TOKEN_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredSessionState;
      if (parsed.status === 'authenticated' && parsed.session && isUserRole(parsed.session.role)) {
        return parsed.session;
      }
      return null;
    }

    const raw = window.localStorage.getItem(MOCK_SESSION_STORAGE_KEY);
    if (!raw) {
      const defaultManager: UserSession = { ...SEED_MOCK_USERS.manager };
      window.localStorage.setItem(
        MOCK_SESSION_STORAGE_KEY,
        JSON.stringify({ status: 'authenticated', session: defaultManager }),
      );
      return defaultManager;
    }

    const parsed = JSON.parse(raw) as StoredSessionState;
    if (parsed.status === 'signed_out') {
      return null;
    }
    if (
      parsed.status === 'authenticated' &&
      parsed.session &&
      isUserRole(parsed.session.role)
    ) {
      return parsed.session;
    }
  } catch {
    // Fall back to default manager in mock mode
  }

  if (authMode === 'mock') {
    const defaultManager: UserSession = { ...SEED_MOCK_USERS.manager };
    window.localStorage.setItem(
      MOCK_SESSION_STORAGE_KEY,
      JSON.stringify({ status: 'authenticated', session: defaultManager }),
    );
    return defaultManager;
  }
  return null;
}

export interface AuthProviderProps {
  children: React.ReactNode;
  authModeOverride?: 'mock' | 'gis';
  gasEndpointOverride?: string;
  fetchImpl?: typeof fetch;
}

export function AuthProvider({
  children,
  authModeOverride,
  gasEndpointOverride,
  fetchImpl,
}: AuthProviderProps): React.JSX.Element {
  const authMode = authModeOverride ?? resolveDefaultAuthMode();
  const [session, setSession] = useState<UserSession | null>(() =>
    hydrateInitialSession(authMode),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const switchMockProfile = useCallback(
    (role: UserRole, customDisplayName?: string) => {
      const template = SEED_MOCK_USERS[role];
      const nextSession: UserSession = {
        ...template,
        displayName: customDisplayName?.trim() || template.displayName,
      };
      setAuthError(null);
      setSession(nextSession);
      window.localStorage.setItem(
        MOCK_SESSION_STORAGE_KEY,
        JSON.stringify({ status: 'authenticated', session: nextSession }),
      );
    },
    [],
  );

  const signOut = useCallback(() => {
    setAuthError(null);
    setSession(null);
    const key =
      authMode === 'gis' ? GIS_TOKEN_STORAGE_KEY : MOCK_SESSION_STORAGE_KEY;
    // Never clear app-icol:dataset:v1 or app-icol:sale-draft:* on signOut!
    window.localStorage.setItem(key, JSON.stringify({ status: 'signed_out' }));
    window.google?.accounts?.id?.disableAutoSelect?.();
  }, [authMode]);

  const signInWithGoogleCredential = useCallback(
    async (idToken: string) => {
      setIsLoading(true);
      setAuthError(null);
      try {
        const endpointUrl =
          gasEndpointOverride ?? import.meta.env.VITE_GAS_WEBAPP_URL ?? '';
        if (endpointUrl) {
          const client = new GasApiClient({
            endpointUrl,
            getIdToken: () => idToken,
            fetchImpl,
          });
          const verified = await client.verifySession(idToken);
          const sessionWithToken: UserSession = { ...verified, idToken };
          setSession(sessionWithToken);
          window.localStorage.setItem(
            authMode === 'gis' ? GIS_TOKEN_STORAGE_KEY : MOCK_SESSION_STORAGE_KEY,
            JSON.stringify({ status: 'authenticated', session: sessionWithToken }),
          );
        } else {
          const fallbackSession: UserSession = {
            ...SEED_MOCK_USERS.manager,
            idToken,
          };
          setSession(fallbackSession);
          window.localStorage.setItem(
            MOCK_SESSION_STORAGE_KEY,
            JSON.stringify({ status: 'authenticated', session: fallbackSession }),
          );
        }
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Échec de la vérification Google Sign-In.";
        setAuthError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [authMode, gasEndpointOverride, fetchImpl],
  );

  // Restore default manager session when DataProvider dispatches 'app-icol:mock-reset'
  useEffect(() => {
    const handleMockReset = (): void => {
      const defaultManager: UserSession = { ...SEED_MOCK_USERS.manager };
      setAuthError(null);
      setSession(defaultManager);
      window.localStorage.setItem(
        MOCK_SESSION_STORAGE_KEY,
        JSON.stringify({ status: 'authenticated', session: defaultManager }),
      );
    };
    window.addEventListener('app-icol:mock-reset', handleMockReset);
    return () => {
      window.removeEventListener('app-icol:mock-reset', handleMockReset);
    };
  }, []);

  // Dynamically inject Google Identity Services script ONLY in 'gis' mode (zero external requests in 'mock' mode!)
  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (authMode !== 'gis' || !clientId) {
      return;
    }

    const mountGisButton = (): void => {
      const googleId = window.google?.accounts?.id;
      if (!googleId) return;
      googleId.initialize({
        client_id: clientId,
        callback: (res) => {
          if (res.credential) {
            void signInWithGoogleCredential(res.credential);
          }
        },
      });
      const slot = document.getElementById('gis-button-slot');
      if (slot) {
        googleId.renderButton(slot, {
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'pill',
          locale: 'fr',
        });
      }
    };

    if (window.google?.accounts?.id) {
      mountGisButton();
      return;
    }

    const existing = document.getElementById('app-icol-gis-script');
    if (existing) {
      existing.addEventListener('load', mountGisButton, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = 'app-icol-gis-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.addEventListener('load', mountGisButton, { once: true });
    document.head.appendChild(script);
  }, [authMode, session, signInWithGoogleCredential]);

  const isAuthenticated = session !== null;
  const isManager = session?.role === 'manager';
  const isContributor = session?.role === 'contributor';
  const roleStatusLabel: AuthContextValue['roleStatusLabel'] = !session
    ? 'unauthenticated'
    : session.role;

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isAuthenticated,
      isLoading,
      authError,
      isManager,
      isContributor,
      authMode,
      roleStatusLabel,
      signInWithGoogleCredential,
      switchMockProfile,
      signOut,
    }),
    [
      session,
      isAuthenticated,
      isLoading,
      authError,
      isManager,
      isContributor,
      authMode,
      roleStatusLabel,
      signInWithGoogleCredential,
      switchMockProfile,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }
  return ctx;
}
