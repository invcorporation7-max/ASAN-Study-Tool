import { initializeApp } from 'firebase/app';
import {
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  User,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

const cfg = firebaseConfig as Record<string, string | undefined>;
export const db = cfg.firestoreDatabaseId
  ? getFirestore(app, cfg.firestoreDatabaseId)
  : getFirestore(app);

// Workspace scopes are ONLY requested on-demand when the user explicitly opts in
export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/meetings.space.created',
  'https://www.googleapis.com/auth/meetings.space.readonly',
];

// Basic sign-in provider: NO Drive/Workspace scopes requested at login
export const basicGoogleAuthProvider = new GoogleAuthProvider();
basicGoogleAuthProvider.setCustomParameters({ prompt: 'select_account' });

// Opt-in Drive-only provider for Basic users storing unlimited notes/tasks .txt files in ASAN-user-content
export const driveFolderOnlyAuthProvider = new GoogleAuthProvider();
driveFolderOnlyAuthProvider.addScope('https://www.googleapis.com/auth/drive.file');
driveFolderOnlyAuthProvider.setCustomParameters({ prompt: 'consent' });

// Incremental on-demand Workspace provider: only invoked when Pro/Admin user clicks Connect Workspace
export const workspaceGoogleAuthProvider = new GoogleAuthProvider();
WORKSPACE_SCOPES.forEach((scope) => {
  workspaceGoogleAuthProvider.addScope(scope);
});
workspaceGoogleAuthProvider.setCustomParameters({ prompt: 'consent' });

// In-memory OAuth access token cache (never stored in localStorage/sessionStorage)
let cachedWorkspaceToken: string | null = null;
let isSigningIn = false;

export const getAccessToken = (): string | null => cachedWorkspaceToken;

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
  const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
  switch (code) {
    case 'auth/unauthorized-domain':
      return new Error(
        `Google Sign-In is blocked for "${host}" (auth/unauthorized-domain). Add "${host}" in Firebase Console -> Authentication -> Settings -> Authorized domains.`
      );
    case 'auth/popup-blocked':
      return new Error('Sign-in popup was blocked by your browser. Please allow popups or use Email & Password Sign-In.');
    case 'auth/popup-closed-by-user':
      return new Error('Google Sign-In popup was closed before finishing.');
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

// Opt-in folder-isolated Drive access ONLY (for Basic users backing up unlimited .txt tasks/notes)
export const connectBasicDriveFolderOAuth = async (): Promise<{
  user: User;
  accessToken: string;
}> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, driveFolderOnlyAuthProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Could not obtain Google Drive folder access token.');
    }
    cachedWorkspaceToken = credential.accessToken;
    return { user: result.user, accessToken: cachedWorkspaceToken };
  } catch (error) {
    if (shouldFallbackToRedirect(error)) {
      try {
        await signInWithRedirect(auth, driveFolderOnlyAuthProvider);
        throw new RedirectPendingError('Redirecting to Google Drive authorization...');
      } catch (redirectErr) {
        if (isRedirectInProgressError(redirectErr)) throw redirectErr;
        throw formatFirebaseAuthError(redirectErr);
      }
    }
    console.error('Basic Drive folder authorization failed:', error);
    throw formatFirebaseAuthError(error);
  } finally {
    isSigningIn = false;
  }
};

// Explicit opt-in Workspace authorization (only triggered when user clicks to connect Drive/Workspace)
export const connectWorkspaceOAuth = async (): Promise<{
  user: User;
  accessToken: string;
}> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, workspaceGoogleAuthProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Could not obtain Google Workspace access token.');
    }
    cachedWorkspaceToken = credential.accessToken;
    return { user: result.user, accessToken: cachedWorkspaceToken };
  } catch (error) {
    if (shouldFallbackToRedirect(error)) {
      try {
        await signInWithRedirect(auth, workspaceGoogleAuthProvider);
        throw new RedirectPendingError('Redirecting to Google Workspace authorization...');
      } catch (redirectErr) {
        if (isRedirectInProgressError(redirectErr)) throw redirectErr;
        throw formatFirebaseAuthError(redirectErr);
      }
    }
    console.error('Workspace opt-in authorization failed:', error);
    throw formatFirebaseAuthError(error);
  } finally {
    isSigningIn = false;
  }
};

export const logout = async (): Promise<void> => {
  cachedWorkspaceToken = null;
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
