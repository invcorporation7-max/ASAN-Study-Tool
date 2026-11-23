import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { User } from 'firebase/auth';
import {
  apiFetch,
  apiPublicFetch,
  ensureAppDriveFolder,
  getPasswordSessionToken,
  setPasswordSessionToken,
} from '../lib/api';
import {
  connectBasicDriveFolderOAuth,
  connectWorkspaceOAuth,
  consumeAuthRedirectResult,
  getAccessToken,
  googleSignIn,
  isRedirectInProgressError,
  logout,
  subscribeAuth,
} from '../lib/firebase';
import type { DbUser, SavedAccountEntry, WorkspacePermissionsConfig } from '../types';

const GUEST_STORAGE_KEY = 'asan_guest_free_mode';
const SAVED_ACCOUNTS_KEY = 'asan_saved_accounts_v1';
const PERM_PROMPT_DISMISSED_PREFIX = 'asan_perm_prompt_dismissed_';
const WORKSPACE_PERMS_KEY = 'asan_workspace_perms_v1';

const DEFAULT_WORKSPACE_PERMISSIONS: WorkspacePermissionsConfig = {
  driveSync: true,
  docsExport: true,
  sheetsSync: true,
  meetRooms: true,
};

function loadWorkspacePermissions(): WorkspacePermissionsConfig {
  try {
    const raw = localStorage.getItem(WORKSPACE_PERMS_KEY);
    if (!raw) return { ...DEFAULT_WORKSPACE_PERMISSIONS };
    const parsed = JSON.parse(raw) as Partial<WorkspacePermissionsConfig>;
    return {
      driveSync: typeof parsed.driveSync === 'boolean' ? parsed.driveSync : true,
      docsExport: typeof parsed.docsExport === 'boolean' ? parsed.docsExport : true,
      sheetsSync: typeof parsed.sheetsSync === 'boolean' ? parsed.sheetsSync : true,
      meetRooms: typeof parsed.meetRooms === 'boolean' ? parsed.meetRooms : true,
    };
  } catch {
    return { ...DEFAULT_WORKSPACE_PERMISSIONS };
  }
}

function saveWorkspacePermissions(perms: WorkspacePermissionsConfig) {
  try {
    localStorage.setItem(WORKSPACE_PERMS_KEY, JSON.stringify(perms));
  } catch {
    // ignore
  }
}

export type PermissionStep = 'drive' | 'workspace' | null;

interface AuthContextValue {
  firebaseUser: User | null;
  dbUser: DbUser | null;
  isGuest: boolean;
  authMode: 'google' | 'password' | 'guest';
  isWorkspaceEnabled: boolean;
  isSuper: boolean;
  isAdmin: boolean;
  isApprovedContributor: boolean;
  effectivePlan: 'free' | 'basic' | 'pro';
  isEffectiveProOrAdmin: boolean;
  workspaceToken: string | null;
  loading: boolean;
  error: string | null;
  permissionStep: PermissionStep;
  savedAccounts: SavedAccountEntry[];
  prefillIdentifier: string;
  signIn: () => Promise<void>;
  signInWithPassword: (identifier: string, password: string) => Promise<void>;
  registerWithPassword: (params: {
    email: string;
    password: string;
    displayName?: string;
  }) => Promise<void>;
  setAccountPassword: (password: string) => Promise<string>;
  switchAccount: (entry: SavedAccountEntry) => Promise<void>;
  startSwitchToNewLogin: () => Promise<void>;
  removeSavedAccount: (uid: string) => void;
  continueFreeGuest: () => void;
  exitGuestToSignIn: () => void;
  connectBasicDrive: () => Promise<string | null>;
  connectWorkspace: () => Promise<string | null>;
  acceptDriveFolderPermissionStep: () => Promise<void>;
  acceptWorkspacePermissionStep: () => Promise<void>;
  skipPermissionStep: () => void;
  openPermissionFlow: () => void;
  signOutUser: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (updates: {
    displayName?: string;
    username?: string;
    spectraUrl?: string;
    driveFolderId?: string;
    scheduleSheetId?: string;
    viewPlanMode?: 'auto' | 'basic';
    workspacePermissions?: WorkspacePermissionsConfig;
  }) => Promise<void>;
  workspacePermissions: WorkspacePermissionsConfig;
  updateWorkspacePermissions: (patch: Partial<WorkspacePermissionsConfig>) => Promise<void>;
  setViewPlanMode: (mode: 'auto' | 'basic') => Promise<void>;
  switchPlanAdmin: (plan: 'basic' | 'pro') => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadSavedAccounts(): SavedAccountEntry[] {
  try {
    const raw = localStorage.getItem(SAVED_ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSavedAccountsList(list: SavedAccountEntry[]) {
  try {
    localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(list.slice(0, 8)));
  } catch {
    // ignore
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [dbUser, setDbUser] = useState<DbUser | null>(null);
  const [isGuest, setIsGuest] = useState<boolean>(() => {
    try {
      return localStorage.getItem(GUEST_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [workspaceToken, setWorkspaceToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permissionStep, setPermissionStep] = useState<PermissionStep>(null);
  const [savedAccounts, setSavedAccounts] = useState<SavedAccountEntry[]>(() =>
    loadSavedAccounts()
  );
  const [prefillIdentifier, setPrefillIdentifier] = useState('');
  const [localWorkspacePerms, setLocalWorkspacePerms] = useState<WorkspacePermissionsConfig>(() =>
    loadWorkspacePermissions()
  );

  const recordSavedAccount = useCallback(
    (profile: DbUser, mode: 'google' | 'password', pwdToken?: string | null) => {
      setSavedAccounts((prev) => {
        const filtered = prev.filter(
          (a) =>
            a.uid !== profile.uid &&
            a.email.toLowerCase() !== profile.email.toLowerCase()
        );
        const next: SavedAccountEntry[] = [
          {
            uid: profile.uid,
            shortUid: profile.shortUid,
            email: profile.email,
            username: profile.username,
            displayName: profile.displayName,
            photoUrl: profile.photoUrl,
            role: profile.role,
            plan: profile.plan,
            authMode: mode,
            passwordToken: mode === 'password' ? pwdToken || undefined : undefined,
            lastUsedAt: new Date().toISOString(),
          },
          ...filtered,
        ].slice(0, 8);
        saveSavedAccountsList(next);
        return next;
      });
    },
    []
  );

  const maybePromptSequentialPermissions = useCallback(
    (profile: DbUser, mode: 'google' | 'password') => {
      if (mode !== 'google') {
        setPermissionStep(null);
        return;
      }
      if (profile.driveFolderId) {
        setPermissionStep(null);
        return;
      }
      try {
        const dismissed =
          localStorage.getItem(`${PERM_PROMPT_DISMISSED_PREFIX}${profile.uid}`) === '1';
        if (dismissed) return;
      } catch {
        // ignore
      }
      setPermissionStep('drive');
    },
    []
  );

  const syncUserProfile = useCallback(
    async (explicitMode?: 'google' | 'password', explicitPwdToken?: string | null) => {
      try {
        const profile = await apiFetch<DbUser>('/api/me');
        const resolvedMode: 'google' | 'password' =
          explicitMode ||
          (getPasswordSessionToken() ? 'password' : profile.authMode === 'password' ? 'password' : 'google');
        const enriched: DbUser = { ...profile, authMode: resolvedMode };
        setDbUser(enriched);
        setError(null);
        recordSavedAccount(enriched, resolvedMode, explicitPwdToken ?? getPasswordSessionToken());
        maybePromptSequentialPermissions(enriched, resolvedMode);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load user account';
        if (
          (explicitMode === 'password' || getPasswordSessionToken()) &&
          /unauthorized|401|expired|no longer exists/i.test(msg)
        ) {
          setPasswordSessionToken(null);
          setDbUser(null);
        }
        setError(msg);
      }
    },
    [maybePromptSequentialPermissions, recordSavedAccount]
  );

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      try {
        const res = await consumeAuthRedirectResult();
        if (res.accessToken && active) {
          setWorkspaceToken(res.accessToken);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Google sign-in redirect failed');
        }
      }

      const pwdToken = getPasswordSessionToken();
      if (pwdToken) {
        if (active) {
          setIsGuest(false);
          await syncUserProfile('password', pwdToken);
          setLoading(false);
        }
      }
    };

    void bootstrap();

    const unsub = subscribeAuth(async (user, token) => {
      if (!active) return;
      const pwdToken = getPasswordSessionToken();
      if (pwdToken && !user) {
        // Password session is active without Firebase user
        setFirebaseUser(null);
        setWorkspaceToken(null);
        setLoading(false);
        return;
      }

      setFirebaseUser(user);
      setWorkspaceToken(token || getAccessToken());
      if (user) {
        setPasswordSessionToken(null);
        setIsGuest(false);
        try {
          localStorage.removeItem(GUEST_STORAGE_KEY);
        } catch {
          // ignore
        }
        await syncUserProfile('google', null);
      } else if (!pwdToken) {
        setDbUser(null);
      }
      setLoading(false);
    });

    return () => {
      active = false;
      unsub();
    };
  }, [syncUserProfile]);

  // Basic Sign-In ONLY (does not request Google Drive / Workspace scopes on login)
  const signIn = useCallback(async () => {
    setError(null);
    setLoading(true);
    let redirecting = false;
    try {
      setPasswordSessionToken(null);
      const res = await googleSignIn();
      setIsGuest(false);
      try {
        localStorage.removeItem(GUEST_STORAGE_KEY);
      } catch {
        // ignore
      }
      setFirebaseUser(res.user);
      await syncUserProfile('google', null);
    } catch (err) {
      if (isRedirectInProgressError(err)) {
        redirecting = true;
        return;
      }
      setError(err instanceof Error ? err.message : 'Google sign-in failed');
    } finally {
      if (!redirecting) {
        setLoading(false);
      }
    }
  }, [syncUserProfile]);

  const signInWithPassword = useCallback(
    async (identifier: string, password: string) => {
      setError(null);
      setLoading(true);
      try {
        const res = await apiPublicFetch<{ token: string; user: DbUser }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ identifier, password }),
        });
        await logout().catch(() => {});
        setFirebaseUser(null);
        setWorkspaceToken(null);
        setPasswordSessionToken(res.token);
        setIsGuest(false);
        try {
          localStorage.removeItem(GUEST_STORAGE_KEY);
        } catch {
          // ignore
        }
        const enriched: DbUser = { ...res.user, authMode: 'password' };
        setDbUser(enriched);
        setPermissionStep(null);
        setPrefillIdentifier('');
        recordSavedAccount(enriched, 'password', res.token);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Email/Password sign-in failed';
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [recordSavedAccount]
  );

  const registerWithPassword = useCallback(
    async (params: { email: string; password: string; displayName?: string }) => {
      setError(null);
      setLoading(true);
      try {
        const res = await apiPublicFetch<{ token: string; user: DbUser }>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify(params),
        });
        await logout().catch(() => {});
        setFirebaseUser(null);
        setWorkspaceToken(null);
        setPasswordSessionToken(res.token);
        setIsGuest(false);
        try {
          localStorage.removeItem(GUEST_STORAGE_KEY);
        } catch {
          // ignore
        }
        const enriched: DbUser = { ...res.user, authMode: 'password' };
        setDbUser(enriched);
        setPermissionStep(null);
        setPrefillIdentifier('');
        recordSavedAccount(enriched, 'password', res.token);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Registration failed';
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [recordSavedAccount]
  );

  const setAccountPassword = useCallback(async (password: string): Promise<string> => {
    try {
      const res = await apiFetch<{ ok: boolean; user: DbUser; message: string }>(
        '/api/auth/set-password',
        {
          method: 'POST',
          body: JSON.stringify({ password }),
        }
      );
      setDbUser((prev) => ({
        ...res.user,
        authMode: res.user.authMode || prev?.authMode || 'google',
      }));
      return res.message;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update password';
      setError(msg);
      throw err;
    }
  }, []);

  const switchAccount = useCallback(
    async (entry: SavedAccountEntry) => {
      setError(null);
      if (entry.authMode === 'password') {
        if (entry.passwordToken) {
          setLoading(true);
          try {
            await logout().catch(() => {});
            setFirebaseUser(null);
            setWorkspaceToken(null);
            setPasswordSessionToken(entry.passwordToken);
            setIsGuest(false);
            await syncUserProfile('password', entry.passwordToken);
            setPermissionStep(null);
          } catch {
            setPasswordSessionToken(null);
            setDbUser(null);
            setPrefillIdentifier(entry.email);
          } finally {
            setLoading(false);
          }
          return;
        }
        setPasswordSessionToken(null);
        await logout().catch(() => {});
        setFirebaseUser(null);
        setDbUser(null);
        setIsGuest(false);
        setPrefillIdentifier(entry.email);
        return;
      }

      // Google account switch
      setPasswordSessionToken(null);
      await signIn();
    },
    [signIn, syncUserProfile]
  );

  const startSwitchToNewLogin = useCallback(async () => {
    setPasswordSessionToken(null);
    await logout().catch(() => {});
    setFirebaseUser(null);
    setDbUser(null);
    setWorkspaceToken(null);
    setPermissionStep(null);
    setIsGuest(false);
    setPrefillIdentifier('');
    try {
      localStorage.removeItem(GUEST_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const removeSavedAccount = useCallback((uid: string) => {
    setSavedAccounts((prev) => {
      const next = prev.filter((a) => a.uid !== uid);
      saveSavedAccountsList(next);
      return next;
    });
  }, []);

  const continueFreeGuest = useCallback(() => {
    setError(null);
    setPasswordSessionToken(null);
    setPermissionStep(null);
    setIsGuest(true);
    try {
      localStorage.setItem(GUEST_STORAGE_KEY, '1');
    } catch {
      // ignore
    }
  }, []);

  const exitGuestToSignIn = useCallback(() => {
    setIsGuest(false);
    try {
      localStorage.removeItem(GUEST_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const connectBasicDrive = useCallback(async () => {
    setError(null);
    try {
      const res = await connectBasicDriveFolderOAuth();
      setFirebaseUser(res.user);
      setWorkspaceToken(res.accessToken);
      return res.accessToken;
    } catch (err) {
      if (!isRedirectInProgressError(err)) {
        setError(
          err instanceof Error ? err.message : 'Failed to connect ASAN-user-content Drive folder'
        );
      }
      return null;
    }
  }, []);

  const connectWorkspace = useCallback(async () => {
    setError(null);
    try {
      const res = await connectWorkspaceOAuth();
      setFirebaseUser(res.user);
      setWorkspaceToken(res.accessToken);
      return res.accessToken;
    } catch (err) {
      if (!isRedirectInProgressError(err)) {
        setError(
          err instanceof Error ? err.message : 'Failed to connect Google Workspace'
        );
      }
      return null;
    }
  }, []);

  const updateProfile = useCallback(
    async (updates: {
      displayName?: string;
      username?: string;
      spectraUrl?: string;
      driveFolderId?: string;
      scheduleSheetId?: string;
      viewPlanMode?: 'auto' | 'basic';
      workspacePermissions?: WorkspacePermissionsConfig;
    }) => {
      try {
        const updated = await apiFetch<DbUser>('/api/me', {
          method: 'PATCH',
          body: JSON.stringify(updates),
        });
        setDbUser((prev) => ({
          ...updated,
          authMode: updated.authMode || prev?.authMode || 'google',
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to save profile changes';
        setError(msg);
        throw err;
      }
    },
    []
  );

  const acceptDriveFolderPermissionStep = useCallback(async () => {
    const token = await connectBasicDrive();
    if (!token) return;
    try {
      const folder = await ensureAppDriveFolder(dbUser?.driveFolderId);
      await updateProfile({ driveFolderId: folder.id });
      const proCapable =
        dbUser?.plan === 'pro' || dbUser?.role === 'admin' || dbUser?.role === 'super';
      if (proCapable) {
        setPermissionStep('workspace');
      } else {
        setPermissionStep(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create ASAN-user-content Drive folder.');
    }
  }, [connectBasicDrive, dbUser, updateProfile]);

  const acceptWorkspacePermissionStep = useCallback(async () => {
    const token = await connectWorkspace();
    if (token) {
      if (dbUser && !dbUser.driveFolderId) {
        try {
          const folder = await ensureAppDriveFolder();
          await updateProfile({ driveFolderId: folder.id });
        } catch {
          // ignore
        }
      }
      setPermissionStep(null);
    }
  }, [connectWorkspace, dbUser, updateProfile]);

  const skipPermissionStep = useCallback(() => {
    if (permissionStep === 'drive') {
      const proCapable =
        dbUser?.plan === 'pro' || dbUser?.role === 'admin' || dbUser?.role === 'super';
      if (proCapable) {
        setPermissionStep('workspace');
        return;
      }
    }
    if (dbUser?.uid) {
      try {
        localStorage.setItem(`${PERM_PROMPT_DISMISSED_PREFIX}${dbUser.uid}`, '1');
      } catch {
        // ignore
      }
    }
    setPermissionStep(null);
  }, [dbUser, permissionStep]);

  const openPermissionFlow = useCallback(() => {
    setPermissionStep('drive');
  }, []);

  const signOutUser = useCallback(async () => {
    setPasswordSessionToken(null);
    await logout().catch(() => {});
    setFirebaseUser(null);
    setDbUser(null);
    setWorkspaceToken(null);
    setPermissionStep(null);
    setIsGuest(false);
    try {
      localStorage.removeItem(GUEST_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    const pwdToken = getPasswordSessionToken();
    if (!firebaseUser && !pwdToken) return;
    await syncUserProfile(pwdToken ? 'password' : 'google', pwdToken);
  }, [firebaseUser, syncUserProfile]);

  const setViewPlanMode = useCallback(
    async (mode: 'auto' | 'basic') => {
      await updateProfile({ viewPlanMode: mode });
    },
    [updateProfile]
  );

  const switchPlanAdmin = useCallback(async (plan: 'basic' | 'pro') => {
    try {
      const updated = await apiFetch<DbUser>('/api/me/plan', {
        method: 'POST',
        body: JSON.stringify({ plan }),
      });
      setDbUser((prev) => ({
        ...updated,
        authMode: updated.authMode || prev?.authMode || 'google',
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch plan');
    }
  }, []);

  const authMode: 'google' | 'password' | 'guest' = isGuest
    ? 'guest'
    : dbUser?.authMode === 'password' || Boolean(getPasswordSessionToken())
      ? 'password'
      : 'google';

  const isWorkspaceEnabled = !isGuest && authMode === 'google';
  const isSuper =
    !isGuest &&
    dbUser?.role === 'super' &&
    dbUser.email.toLowerCase() === 'invcorporation7@gmail.com';
  const isAdmin = !isGuest && (dbUser?.role === 'admin' || dbUser?.role === 'super');
  const isApprovedContributor =
    !isGuest &&
    (isAdmin || (dbUser?.role === 'contributor' && Boolean(dbUser?.contributorApproved)));

  const effectivePlan: 'free' | 'basic' | 'pro' = isGuest
    ? 'free'
    : dbUser?.viewPlanMode === 'basic'
      ? 'basic'
      : dbUser?.plan === 'pro'
        ? 'pro'
        : 'basic';

  const isEffectiveProOrAdmin =
    !isGuest &&
    dbUser?.viewPlanMode !== 'basic' &&
    (dbUser?.plan === 'pro' || dbUser?.role === 'admin' || dbUser?.role === 'super');

  const workspacePermissions: WorkspacePermissionsConfig =
    !isGuest && dbUser?.workspacePermissions
      ? {
          ...DEFAULT_WORKSPACE_PERMISSIONS,
          ...dbUser.workspacePermissions,
        }
      : localWorkspacePerms;

  const updateWorkspacePermissions = useCallback(
    async (patch: Partial<WorkspacePermissionsConfig>) => {
      const next: WorkspacePermissionsConfig = {
        ...workspacePermissions,
        ...patch,
      };
      setLocalWorkspacePerms(next);
      saveWorkspacePermissions(next);
      if (!isGuest && dbUser) {
        await updateProfile({ workspacePermissions: next }).catch(() => {});
      }
    },
    [dbUser, isGuest, updateProfile, workspacePermissions]
  );

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        dbUser,
        isGuest,
        authMode,
        isWorkspaceEnabled,
        isSuper,
        isAdmin,
        isApprovedContributor,
        effectivePlan,
        isEffectiveProOrAdmin,
        workspaceToken,
        loading,
        error,
        permissionStep,
        savedAccounts,
        prefillIdentifier,
        signIn,
        signInWithPassword,
        registerWithPassword,
        setAccountPassword,
        switchAccount,
        startSwitchToNewLogin,
        removeSavedAccount,
        continueFreeGuest,
        exitGuestToSignIn,
        connectBasicDrive,
        connectWorkspace,
        acceptDriveFolderPermissionStep,
        acceptWorkspacePermissionStep,
        skipPermissionStep,
        openPermissionFlow,
        signOutUser,
        refreshProfile,
        updateProfile,
        workspacePermissions,
        updateWorkspacePermissions,
        setViewPlanMode,
        switchPlanAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
