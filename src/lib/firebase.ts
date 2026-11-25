import { initializeApp } from 'firebase/app';
import {
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithPopup,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  User,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const rawCfg = firebaseConfig as Record<string, string | undefined>;
const envVal = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

const effectiveFirebaseConfig = {
  ...firebaseConfig,
  ...(envVal(import.meta.env.VITE_FIREBASE_API_KEY)
    ? { apiKey: envVal(import.meta.env.VITE_FIREBASE_API_KEY)! }
    : {}),
  ...(envVal(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN)
    ? { authDomain: envVal(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN)! }
    : {}),
  ...(envVal(import.meta.env.VITE_FIREBASE_PROJECT_ID)
    ? { projectId: envVal(import.meta.env.VITE_FIREBASE_PROJECT_ID)! }
    : {}),
  ...(envVal(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET)
    ? { storageBucket: envVal(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET)! }
    : {}),
  ...(envVal(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID)
    ? { messagingSenderId: envVal(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID)! }
    : {}),
  ...(envVal(import.meta.env.VITE_FIREBASE_APP_ID)
    ? { appId: envVal(import.meta.env.VITE_FIREBASE_APP_ID)! }
    : {}),
};

const app = initializeApp(effectiveFirebaseConfig);
export const auth = getAuth(app);

export const db = rawCfg.firestoreDatabaseId
  ? getFirestore(app, rawCfg.firestoreDatabaseId)
  : getFirestore(app);

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DOCS_SCOPE = 'https://www.googleapis.com/auth/documents';
export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
export const MEET_SCOPES = [
  'https://www.googleapis.com/auth/meetings.space.created',
  'https://www.googleapis.com/auth/meetings.space.readonly',
];

// Full Workspace scope list (used only when all Workspace features are authorized together)
export const WORKSPACE_SCOPES = [
  DRIVE_FILE_SCOPE,
  DOCS_SCOPE,
  SHEETS_SCOPE,
  ...MEET_SCOPES,
];

// Basic sign-in provider: NO Drive/Workspace scopes requested at login
export const basicGoogleAuthProvider = new GoogleAuthProvider();
basicGoogleAuthProvider.setCustomParameters({ prompt: 'select_account' });

// Opt-in Drive-only provider for Basic users storing unlimited notes/tasks .txt files in ASAN-user-content
export const driveFolderOnlyAuthProvider = new GoogleAuthProvider();
driveFolderOnlyAuthProvider.addScope(DRIVE_FILE_SCOPE);
driveFolderOnlyAuthProvider.setCustomParameters({ prompt: 'consent' });

// Incremental on-demand Workspace provider: only invoked when Pro/Admin user connects Workspace
export const workspaceGoogleAuthProvider = new GoogleAuthProvider();
WORKSPACE_SCOPES.forEach((scope) => {
  workspaceGoogleAuthProvider.addScope(scope);
});
workspaceGoogleAuthProvider.setCustomParameters({ prompt: 'consent' });

// In-memory OAuth access token & granted-scopes cache (never stored in localStorage/sessionStorage)
let cachedWorkspaceToken: string | null = null;
const cachedGrantedScopes = new Set<string>();
let isSigningIn = false;

export const WORKSPACE_TOKEN_CLEARED_EVENT = 'asan-workspace-token-cleared';

export const getAccessToken = (): string | null => cachedWorkspaceToken;

export const hasWorkspaceScopes = (requiredScopes: string[]): boolean => {
  if (!cachedWorkspaceToken) return false;
  if (requiredScopes.length === 0) return true;
  return requiredScopes.every((scope) => cachedGrantedScopes.has(scope));
};

export const clearAccessToken = (): void => {
  cachedWorkspaceToken = null;
  cachedGrantedScopes.clear();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(WORKSPACE_TOKEN_CLEARED_EVENT));
  }
};

interface GisTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GisTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string; hint?: string }) => void;
}

interface GisWindow {
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient: (config: {
          client_id: string;
          scope: string;
          hint?: string;
          prompt?: string;
          callback: (resp: GisTokenResponse) => void;
          error_callback?: (err: { type?: string; message?: string }) => void;
        }) => GisTokenClient;
      };
    };
  };
}

function getOAuthClientId(): string {
  const envClientId = (import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string | undefined)?.trim();
  return envClientId || rawCfg.oAuthClientId || '';
}

let gisScriptLoadPromise: Promise<boolean> | null = null;

async function loadGisScript(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const gw = window as unknown as GisWindow;
  if (gw.google?.accounts?.oauth2?.initTokenClient) return true;
  if (gisScriptLoadPromise) return gisScriptLoadPromise;

  gisScriptLoadPromise = new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src^="https://accounts.google.com/gsi/client"]'
    );
    if (existing) {
      let checks = 0;
      const timer = window.setInterval(() => {
        checks += 1;
        if ((window as unknown as GisWindow).google?.accounts?.oauth2?.initTokenClient) {
          window.clearInterval(timer);
          resolve(true);
        } else if (checks > 40) {
          window.clearInterval(timer);
          resolve(false);
        }
      }, 100);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () =>
      resolve(Boolean((window as unknown as GisWindow).google?.accounts?.oauth2?.initTokenClient));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });

  return gisScriptLoadPromise;
}

class GisCancelledError extends Error {
  readonly isCancelled = true;
  constructor(message: string) {
    super(message);
    this.name = 'GisCancelledError';
  }
}

function requestGoogleAccessTokenViaGis(
  scopes: string[],
  loginHint?: string | null
): Promise<string> {
  const clientId = getOAuthClientId();
  const gw = typeof window !== 'undefined' ? (window as unknown as GisWindow) : undefined;
  const initTokenClient = gw?.google?.accounts?.oauth2?.initTokenClient;

  if (!clientId || !initTokenClient) {
    return Promise.reject(
      new Error('Google OAuth client is not ready yet. Please try again in a second.')
    );
  }

  return new Promise<string>((resolve, reject) => {
    try {
      const client = initTokenClient({
        client_id: clientId,
        scope: scopes.join(' '),
        ...(loginHint ? { hint: loginHint } : {}),
        prompt: 'consent',
        callback: (resp: GisTokenResponse) => {
          if (resp.access_token) {
            resolve(resp.access_token);
            return;
          }
          const code = String(resp.error || '').toLowerCase();
          if (code === 'access_denied' || code === 'user_cancel') {
            reject(new GisCancelledError('Google Drive permission was denied or cancelled.'));
            return;
          }
          reject(
            new Error(
              resp.error_description || resp.error || 'Could not obtain Google access token.'
            )
          );
        },
        error_callback: (err) => {
          const type = String(err?.type || '').toLowerCase();
          if (type === 'popup_closed') {
            reject(
              new GisCancelledError('Google authorization popup was closed before finishing.')
            );
            return;
          }
          if (type === 'popup_failed_to_open') {
            reject(
              new Error(
                'Google authorization popup was blocked by your browser. Allow popups for this site and try again.'
              )
            );
            return;
          }
          reject(new Error(err?.message || 'Google authorization popup failed.'));
        },
      });
      client.requestAccessToken({
        prompt: 'consent',
        ...(loginHint ? { hint: loginHint } : {}),
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error('Failed to launch Google OAuth popup.'));
    }
  });
}

export class RedirectPendingError extends Error {
  readonly isRedirectPending = true;
  constructor(message = 'Redirecting to Google Sign-In...') {
    super(message);
    this.name = 'RedirectPendingError';
  }
}

export function isRedirectInProgressError(err: unknown): boolean {
  return (
    err instanceof RedirectPendingError ||
    (typeof err === 'object' &&
      err !== null &&
      'isRedirectPending' in err &&
      Boolean((err as { isRedirectPending?: boolean }).isRedirectPending))
  );
}

function getAuthErrorCode(err: unknown): string {
  try {
    if (typeof err === 'object' && err !== null && 'code' in err) {
      return String((err as { code?: string }).code || '');
    }
  } catch {
    // ignore
  }
  return '';
}

export function formatFirebaseAuthError(err: unknown): Error {
  if (isRedirectInProgressError(err)) {
    return err instanceof Error ? err : new RedirectPendingError();
  }
  const code = getAuthErrorCode(err);
  const rawMsg = err instanceof Error ? err.message : String(err || '');
  const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';

  if (/access_denied|403|developer-approved testers|verification process/i.test(rawMsg)) {
    return new Error(
      'Google OAuth Error 403 (access_denied): This Google Cloud app is in Testing mode and only allows Google accounts listed under Google Cloud Console -> Google Auth Platform -> Audience -> Test users. Add your Gmail as a Test User (or Publish the app), or use Email & Password Sign-In.'
    );
  }

  switch (code) {
    case 'auth/unauthorized-domain':
      return new Error(
        `Google Sign-In is blocked for "${host}" (auth/unauthorized-domain). Add "${host}" in Firebase Console -> Authentication -> Settings -> Authorized domains.`
      );
    case 'auth/popup-blocked':
      return new Error('Sign-in popup was blocked by your browser. Please allow popups or use Email & Password Sign-In.');
    case 'auth/popup-closed-by-user':
      return new Error(
        'Google Sign-In popup was closed before finishing. If Google displayed Error 403 (access_denied / Testing mode), add your Gmail under Google Cloud Console -> Audience -> Test users, or sign in with Email & Password.'
      );
    case 'auth/cancelled-popup-request':
      return new Error('Sign-in request was superseded by a newer popup. Please try once more.');
    case 'auth/account-exists-with-different-credential':
      return new Error('An account already exists with this email under another sign-in provider.');
    case 'auth/invalid-credential':
      return new Error('Google credential expired or could not be verified. Please try signing in again.');
    case 'auth/user-disabled':
      return new Error('This Google account has been disabled in Firebase Auth.');
    case 'auth/operation-not-allowed':
      return new Error('Google Sign-In provider is not enabled in Firebase Console.');
    case 'auth/too-many-requests':
      return new Error('Too many sign-in attempts. Please wait a moment and try again.');
    case 'auth/internal-error':
      return new Error('Google Auth encountered an internal error. Please refresh or use Email & Password Sign-In.');
    case 'auth/network-request-failed':
      return new Error('Network error reaching Google/Firebase Auth. Check your connection or ad-blocker.');
    default:
      return err instanceof Error ? err : new Error('Google Sign-In failed.');
  }
}

function shouldFallbackToRedirect(err: unknown): boolean {
  const code = getAuthErrorCode(err);
  return (
    code === 'auth/popup-blocked' ||
    code === 'auth/operation-not-supported-in-this-environment'
  );
}

// Consume any pending OAuth redirect result (for mobile/PWA standalone fallback)
export const consumeAuthRedirectResult = async (): Promise<{
  user: User | null;
  accessToken: string | null;
}> => {
  try {
    const result = await getRedirectResult(auth);
    if (!result) return { user: null, accessToken: null };
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      cachedWorkspaceToken = credential.accessToken;
    }
    return { user: result.user, accessToken: cachedWorkspaceToken };
  } catch (error) {
    console.error('Google Redirect Sign-In failed:', error);
    throw formatFirebaseAuthError(error);
  }
};

// Standard sign-in (does NOT request Drive/Sheets/Docs/Meet permissions)
export const googleSignIn = async (): Promise<{ user: User }> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, basicGoogleAuthProvider);
    return { user: result.user };
  } catch (error) {
    if (shouldFallbackToRedirect(error)) {
      try {
        await signInWithRedirect(auth, basicGoogleAuthProvider);
        throw new RedirectPendingError('Redirecting to Google Sign-In...');
      } catch (redirectErr) {
        if (isRedirectInProgressError(redirectErr)) throw redirectErr;
        throw formatFirebaseAuthError(redirectErr);
      }
    }
    console.error('Google Sign-In failed:', error);
    throw formatFirebaseAuthError(error);
  } finally {
    isSigningIn = false;
  }
};

function buildScopedGoogleProvider(
  scopes: string[],
  loginHint?: string | null
): GoogleAuthProvider {
  const scoped = new GoogleAuthProvider();
  scopes.forEach((scope) => {
    scoped.addScope(scope);
  });
  scoped.setCustomParameters({
    prompt: 'consent',
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
  return scoped;
}

async function authorizeGoogleScopes(params: {
  scopes: string[];
  provider: GoogleAuthProvider;
  label: string;
}): Promise<{ user: User | null; accessToken: string }> {
  const { scopes, provider, label } = params;
  const uniqueScopes = Array.from(new Set(scopes.filter(Boolean)));
  if (cachedWorkspaceToken && uniqueScopes.every((s) => cachedGrantedScopes.has(s))) {
    return { user: auth.currentUser, accessToken: cachedWorkspaceToken };
  }

  // Preserve any scopes already granted in this session while requesting only the needed scopes
  const mergedScopes = Array.from(new Set([...cachedGrantedScopes, ...uniqueScopes]));

  isSigningIn = true;
  try {
    const clientId = getOAuthClientId();
    const scopedProvider = buildScopedGoogleProvider(mergedScopes, auth.currentUser?.email);

    // Always use Firebase SDK popup FIRST (uses firebaseapp.com/__/auth/handler so dynamic preview/dev origins never hit GIS origin_mismatch)
    try {
      let result;
      if (auth.currentUser) {
        try {
          result = await reauthenticateWithPopup(auth.currentUser, scopedProvider);
        } catch (reauthErr) {
          const reauthCode = getAuthErrorCode(reauthErr);
          if (reauthCode === 'auth/user-mismatch') {
            result = await signInWithPopup(auth, buildScopedGoogleProvider(mergedScopes));
          } else {
            throw reauthErr;
          }
        }
      } else {
        result = await signInWithPopup(auth, scopedProvider);
      }

      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        cachedWorkspaceToken = credential.accessToken;
        mergedScopes.forEach((s) => cachedGrantedScopes.add(s));
        return { user: result.user, accessToken: cachedWorkspaceToken };
      }
      throw new Error(`Could not obtain ${label} access token from Google sign-in.`);
    } catch (fbErr) {
      const code = getAuthErrorCode(fbErr);
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        throw formatFirebaseAuthError(fbErr);
      }

      if (shouldFallbackToRedirect(fbErr)) {
        try {
          await signInWithRedirect(auth, provider);
          throw new RedirectPendingError(`Redirecting to ${label} authorization...`);
        } catch (redirectErr) {
          if (isRedirectInProgressError(redirectErr)) throw redirectErr;
          throw formatFirebaseAuthError(redirectErr);
        }
      }

      // Only fall back to GIS when Firebase Auth rejects an unallowlisted custom domain
      if (code === 'auth/unauthorized-domain' && clientId) {
        try {
          const loaded = await loadGisScript();
          if (loaded) {
            const accessToken = await requestGoogleAccessTokenViaGis(
              mergedScopes,
              auth.currentUser?.email
            );
            cachedWorkspaceToken = accessToken;
            mergedScopes.forEach((s) => cachedGrantedScopes.add(s));
            return { user: auth.currentUser, accessToken };
          }
        } catch (gisErr) {
          if (gisErr instanceof GisCancelledError) {
            throw gisErr;
          }
          console.warn(`${label} GIS fallback failed:`, gisErr);
        }
      }

      console.error(`${label} authorization failed:`, fbErr);
      throw formatFirebaseAuthError(fbErr);
    }
  } finally {
    isSigningIn = false;
  }
}

// Opt-in folder-isolated Drive access ONLY (for Basic users backing up unlimited .txt tasks/notes)
export const connectBasicDriveFolderOAuth = async (): Promise<{
  user: User | null;
  accessToken: string;
}> => {
  return authorizeGoogleScopes({
    scopes: [DRIVE_FILE_SCOPE],
    provider: driveFolderOnlyAuthProvider,
    label: 'Google Drive (ASAN-user-content)',
  });
};

// Explicit opt-in Workspace authorization (requests only requested or enabled scopes incrementally)
export const connectWorkspaceOAuth = async (
  scopes: string[] = WORKSPACE_SCOPES
): Promise<{
  user: User | null;
  accessToken: string;
}> => {
  const effectiveScopes = scopes.length > 0 ? scopes : WORKSPACE_SCOPES;
  const provider =
    effectiveScopes.length === WORKSPACE_SCOPES.length
      ? workspaceGoogleAuthProvider
      : buildScopedGoogleProvider(effectiveScopes);
  return authorizeGoogleScopes({
    scopes: effectiveScopes,
    provider,
    label: 'Google Workspace',
  });
};

export const logout = async (): Promise<void> => {
  cachedWorkspaceToken = null;
  cachedGrantedScopes.clear();
  try {
    await signOut(auth);
  } catch (err) {
    console.warn('Firebase signOut error:', err);
  }
};

export const subscribeAuth = (
  onUser: (user: User | null, workspaceToken: string | null) => void
) => {
  return onAuthStateChanged(
    auth,
    (user) => {
      if (!user) {
        cachedWorkspaceToken = null;
        cachedGrantedScopes.clear();
        onUser(null, null);
        return;
      }
      if (!isSigningIn) {
        onUser(user, cachedWorkspaceToken);
      }
    },
    (err) => {
      console.error('Firebase onAuthStateChanged error:', err);
      onUser(null, null);
    }
  );
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore offline or unconfigured on this project.');
    }
  }
}
