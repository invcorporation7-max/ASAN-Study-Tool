import { auth, getAccessToken } from './firebase';
import {
  handleInbuiltApiRequest,
  inbuiltGetContributorBlob,
  inbuiltGetMaterialBlob,
  inbuiltUploadContributorFile,
  inbuiltUploadStudyMaterial,
} from './inbuiltApi';
import type { ExamBlueprintItem } from '../types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || '';
const PASSWORD_TOKEN_KEY = 'asan_password_session_token';

export function getPasswordSessionToken(): string | null {
  try {
    return localStorage.getItem(PASSWORD_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setPasswordSessionToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(PASSWORD_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(PASSWORD_TOKEN_KEY);
    }
  } catch {
    // ignore
  }
}

export function apiUrl(path: string): string {
  return path.startsWith('http') ? path : `${API_BASE}${path}`;
}

let expressAvailablePromise: Promise<boolean> | null = null;

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 20000
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  if (options.signal) {
    if (options.signal.aborted) {
      ctrl.abort();
    } else {
      options.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    }
  }
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timed out. The server may be waking up—please try again.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function safeJson<T = Record<string, any>>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    return {} as T;
  }
}

function gatewayColdStartMessage(status: number): string | null {
  if (status === 502 || status === 503 || status === 504) {
    return `Server or database is waking up (HTTP ${status}). Please wait a few seconds...`;
  }
  return null;
}

export interface BackendHealthStatus {
  expressReachable: boolean;
  wakingUp: boolean;
  dbConfigured: boolean;
  dbConnected: boolean;
  mode: 'postgres' | 'local-fallback' | 'connecting' | 'inbuilt-offline';
  reason?: string;
}

let cachedExpressMode: 'express' | 'static-inbuilt' | null = null;

export function resetExpressBackendCache(): void {
  expressAvailablePromise = null;
  if (cachedExpressMode === 'static-inbuilt') {
    cachedExpressMode = null;
  }
}

export async function checkBackendHealth(timeoutMs = 8000): Promise<BackendHealthStatus> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false && !API_BASE) {
    return {
      expressReachable: false,
      wakingUp: false,
      dbConfigured: false,
      dbConnected: false,
      mode: 'inbuilt-offline',
      reason: 'Device appears to be offline.',
    };
  }
  try {
    const res = await fetchWithTimeout(
      apiUrl('/api/health'),
      { method: 'GET', cache: 'no-store' },
      timeoutMs
    );
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      return {
        expressReachable: false,
        wakingUp: true,
        dbConfigured: true,
        dbConnected: false,
        mode: 'connecting',
        reason: `Server is waking up (HTTP ${res.status}).`,
      };
    }
    const ct = res.headers.get('content-type') || '';
    if (res.status === 404 || !ct.includes('application/json')) {
      if (!API_BASE) {
        cachedExpressMode = 'static-inbuilt';
      }
      return {
        expressReachable: false,
        wakingUp: false,
        dbConfigured: false,
        dbConnected: false,
        mode: 'inbuilt-offline',
        reason: 'Running in local PWA mode without Express server.',
      };
    }
    const data = await safeJson<{
      status?: string;
      database?: {
        configured?: boolean;
        connected?: boolean;
        mode?: 'postgres' | 'local-fallback';
        reason?: string;
      };
    }>(res);
    if (res.ok && data?.status === 'ok') {
      cachedExpressMode = 'express';
      const dbConfigured = Boolean(data.database?.configured);
      const dbConnected = Boolean(data.database?.connected);
      return {
        expressReachable: true,
        wakingUp: dbConfigured && !dbConnected,
        dbConfigured,
        dbConnected,
        mode: dbConnected ? 'postgres' : dbConfigured ? 'connecting' : 'local-fallback',
        reason: data.database?.reason,
      };
    }
    return {
      expressReachable: false,
      wakingUp: true,
      dbConfigured: true,
      dbConnected: false,
      mode: 'connecting',
      reason: 'Waiting for server health check.',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Server connection pending';
    return {
      expressReachable: false,
      wakingUp: true,
      dbConfigured: true,
      dbConnected: false,
      mode: 'connecting',
      reason: msg,
    };
  }
}

export async function isExpressBackendAvailable(): Promise<boolean> {
  if (API_BASE) return true;
  if (cachedExpressMode === 'express') return true;
  if (cachedExpressMode === 'static-inbuilt') return false;
  if (!expressAvailablePromise) {
    expressAvailablePromise = (async () => {
      try {
        const res = await fetchWithTimeout(
          apiUrl('/api/health'),
          { method: 'GET', cache: 'no-store' },
          6000
        );
        if (res.status === 502 || res.status === 503 || res.status === 504) {
          // Gateway indicates backend server exists and is waking up; do not lock into inbuilt fallback
          expressAvailablePromise = null;
          return true;
        }
        const ct = res.headers.get('content-type') || '';
        if (res.status === 404 || !ct.includes('application/json')) {
          cachedExpressMode = 'static-inbuilt';
          return false;
        }
        const data = await safeJson<{ status?: string }>(res);
        if (res.ok && data?.status === 'ok') {
          cachedExpressMode = 'express';
          return true;
        }
        expressAvailablePromise = null;
        return true;
      } catch {
        // Timeout or transient network failure during cold start: clear probe so future calls retry Express
        expressAvailablePromise = null;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          return false;
        }
        return true;
      }
    })();
  }
  return expressAvailablePromise;
}

async function getActiveAuthToken(forceRefresh = false): Promise<string | null> {
  const pwdToken = getPasswordSessionToken();
  if (pwdToken) return pwdToken;
  const user = auth.currentUser;
  if (user) {
    try {
      return await user.getIdToken(forceRefresh);
    } catch (err) {
      console.warn('Failed to get Firebase ID token:', err);
      return null;
    }
  }
  return null;
}

export async function apiPublicFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const useExpress = await isExpressBackendAvailable();
  if (!useExpress) {
    return handleInbuiltApiRequest<T>(path, options, null);
  }

  try {
    const res = await fetchWithTimeout(apiUrl(path), {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> | undefined),
      },
    });
    if (res.status === 503) {
      const errData = await safeJson<{ error?: string }>(res);
      throw new Error(
        errData?.error || 'Database is waking up or connecting. Please wait a few seconds...'
      );
    }
    const coldMsg = gatewayColdStartMessage(res.status);
    if (coldMsg) {
      throw new Error(coldMsg);
    }
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      if (!API_BASE) {
        cachedExpressMode = 'static-inbuilt';
        return handleInbuiltApiRequest<T>(path, options, null);
      }
      throw new Error('Backend API returned HTML instead of JSON.');
    }
    const data = await safeJson<{ error?: string }>(res);
    if (!res.ok) {
      throw new Error(data?.error || `Request failed (${res.status})`);
    }
    return data as T;
  } catch (err) {
    if (!API_BASE && err instanceof TypeError && typeof navigator !== 'undefined' && navigator.onLine === false) {
      return handleInbuiltApiRequest<T>(path, options, null);
    }
    throw err;
  }
}

export async function fetchPublicCredits<T = { contributors: any[] }>(): Promise<T> {
  return apiPublicFetch<T>('/api/credits');
}

export async function apiOptionalAuthFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getActiveAuthToken(false);
  if (!token) {
    return apiPublicFetch<T>(path, options);
  }
  const useExpress = await isExpressBackendAvailable();
  if (!useExpress || token.startsWith('inbuilt.')) {
    return handleInbuiltApiRequest<T>(path, options, token);
  }
  try {
    return await apiFetch<T>(path, options);
  } catch {
    return apiPublicFetch<T>(path, options);
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getActiveAuthToken(false);
  if (!token) {
    throw new Error('Sign in to sync this feature with your cloud account.');
  }

  const useExpress = await isExpressBackendAvailable();
  if (!useExpress || token.startsWith('inbuilt.')) {
    return handleInbuiltApiRequest<T>(path, options, token);
  }

  const execute = async (forceRefresh: boolean) => {
    const activeToken = await getActiveAuthToken(forceRefresh);
    if (!activeToken) {
      throw new Error('Session expired. Please sign in again.');
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${activeToken}`,
    };
    return fetchWithTimeout(apiUrl(path), { ...options, headers });
  };

  let res: Response;
  try {
    res = await execute(false);
  } catch (err) {
    if (!API_BASE && err instanceof TypeError && typeof navigator !== 'undefined' && navigator.onLine === false) {
      return handleInbuiltApiRequest<T>(path, options, token);
    }
    if (err instanceof TypeError) {
      throw new Error('Server or database is waking up. Please wait a moment and retry.');
    }
    throw err;
  }

  if (res.status === 401 && !getPasswordSessionToken()) {
    res = await execute(true);
  }

  if (res.status === 503) {
    const data = await safeJson<{ error?: string }>(res);
    throw new Error(
      data?.error || 'Database is waking up / connecting. Please wait a moment...'
    );
  }

  const coldMsg = gatewayColdStartMessage(res.status);
  if (coldMsg) {
    throw new Error(coldMsg);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (!API_BASE) {
      cachedExpressMode = 'static-inbuilt';
      return handleInbuiltApiRequest<T>(path, options, token);
    }
    throw new Error(
      'Backend API returned HTML instead of JSON. Check VITE_API_BASE_URL or use the inbuilt Vite API.'
    );
  }

  if (!res.ok) {
    const data = await safeJson<{ error?: string }>(res);
    throw new Error(data?.error || `Request failed (${res.status})`);
  }

  return (await safeJson<T>(res));
}

export async function uploadStudyMaterialBinary<T>(
  file: File,
  metadata: {
    title: string;
    subject: string;
    category: string;
    description?: string;
    pageCount?: number;
    hourlyRentCost: number;
    buyCost?: number;
  }
): Promise<T> {
  const token = await getActiveAuthToken(false);
  if (!token) {
    throw new Error('Sign in to upload study materials or question papers.');
  }
  const useExpress = await isExpressBackendAvailable();
  if (!useExpress || token.startsWith('inbuilt.')) {
    return inbuiltUploadStudyMaterial<T>(file, metadata, token);
  }

  const sendUpload = async (forceRefresh: boolean) => {
    const idToken = await getActiveAuthToken(forceRefresh);
    if (!idToken) throw new Error('Session expired. Please sign in again.');
    return fetchWithTimeout(
      apiUrl('/api/study-materials/upload'),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/octet-stream',
          'x-material-title': encodeURIComponent(metadata.title),
          'x-material-subject': encodeURIComponent(metadata.subject),
          'x-material-category': encodeURIComponent(metadata.category),
          'x-material-description': encodeURIComponent(metadata.description || ''),
          'x-file-name': encodeURIComponent(file.name),
          'x-mime-type': encodeURIComponent(file.type || 'application/octet-stream'),
          'x-page-count': String(Math.max(1, Math.round(metadata.pageCount || 1))),
          'x-hourly-rent-cost': String(Math.max(5, Math.min(100, Math.round(metadata.hourlyRentCost)))),
          ...(metadata.buyCost && metadata.buyCost >= 5
            ? { 'x-buy-cost': String(Math.round(metadata.buyCost)) }
            : {}),
        },
        body: file,
      },
      60000
    );
  };

  let res = await sendUpload(false);
  if (res.status === 401 && !getPasswordSessionToken()) {
    res = await sendUpload(true);
  }
  const coldMsg = gatewayColdStartMessage(res.status);
  if (coldMsg) throw new Error(coldMsg);
  if (!res.ok) {
    const data = await safeJson<{ error?: string }>(res);
    throw new Error(data.error || `Upload failed (${res.status})`);
  }
  return await safeJson<T>(res);
}

export async function fetchStudyMaterialBlob(id: number): Promise<Blob> {
  const token = await getActiveAuthToken(false);
  if (!token) throw new Error('Sign in required to access study materials.');
  const useExpress = await isExpressBackendAvailable();
  if (!useExpress || token.startsWith('inbuilt.')) {
    return inbuiltGetMaterialBlob(id);
  }
  const res = await fetchWithTimeout(
    apiUrl(`/api/study-materials/${id}/download`),
    {
      headers: { Authorization: `Bearer ${token}` },
    },
    60000
  );
  const coldMsg = gatewayColdStartMessage(res.status);
  if (coldMsg) throw new Error(coldMsg);
  if (!res.ok) {
    const data = await safeJson<{ error?: string }>(res);
    throw new Error(data.error || 'Download failed');
  }
  return await res.blob();
}

export async function downloadStudyMaterialFile(id: number, fileName: string): Promise<void> {
  const blob = await fetchStudyMaterialBlob(id);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function uploadContributorFileBinary<T>(
  file: File,
  metadata: { folderId?: number | null; folderPath: string }
): Promise<T> {
  const token = await getActiveAuthToken(false);
  if (!token) {
    throw new Error('Sign in required to upload to Contributors Console.');
  }
  const useExpress = await isExpressBackendAvailable();
  if (!useExpress || token.startsWith('inbuilt.')) {
    return inbuiltUploadContributorFile<T>(file, metadata, token);
  }
  const sendUpload = async (forceRefresh: boolean) => {
    const activeToken = await getActiveAuthToken(forceRefresh);
    if (!activeToken) throw new Error('Session expired. Please sign in again.');
    return fetchWithTimeout(
      apiUrl('/api/contributor-console/files/upload'),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${activeToken}`,
          'Content-Type': 'application/octet-stream',
          'x-folder-id': metadata.folderId ? String(metadata.folderId) : '',
          'x-folder-path': encodeURIComponent(metadata.folderPath || ''),
          'x-file-name': encodeURIComponent(file.name),
          'x-mime-type': encodeURIComponent(file.type || 'application/octet-stream'),
        },
        body: file,
      },
      60000
    );
  };
  let res = await sendUpload(false);
  if (res.status === 401 && !getPasswordSessionToken()) {
    res = await sendUpload(true);
  }
  const coldMsg = gatewayColdStartMessage(res.status);
  if (coldMsg) throw new Error(coldMsg);
  if (!res.ok) {
    const data = await safeJson<{ error?: string }>(res);
    throw new Error(data.error || `Upload failed (${res.status})`);
  }
  return await safeJson<T>(res);
}

export async function fetchContributorFileBlob(id: number): Promise<Blob> {
  const token = await getActiveAuthToken(false);
  if (!token) throw new Error('Sign in required to access contributor files.');
  const useExpress = await isExpressBackendAvailable();
  if (!useExpress || token.startsWith('inbuilt.')) {
    const res = await inbuiltGetContributorBlob(id);
    return res.blob;
  }
  const res = await fetchWithTimeout(
    apiUrl(`/api/contributor-console/files/${id}/download`),
    {
      headers: { Authorization: `Bearer ${token}` },
    },
    60000
  );
  const coldMsg = gatewayColdStartMessage(res.status);
  if (coldMsg) throw new Error(coldMsg);
  if (!res.ok) {
    const data = await safeJson<{ error?: string }>(res);
    throw new Error(data.error || 'Download failed');
  }
  return await res.blob();
}

export async function downloadContributorFile(id: number, fileName: string): Promise<void> {
  const blob = await fetchContributorFileBlob(id);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function buildGmailLicenseComposeUrl(params: {
  recipientEmail: string;
  keyCode: string;
  activationExpiresAt: string;
}) {
  const subject = `Your ASAN-Study_tool Pro License Key: ${params.keyCode}`;
  const body = [
    `Hello,`,
    ``,
    `Here is your ASAN-Study_tool 8-character Pro License Key:`,
    `License Key: ${params.keyCode}`,
    `Valid for Activation Until: ${params.activationExpiresAt.slice(0, 10)} (1 year)`,
    `Subscription Duration: 1 month from activation`,
    ``,
    `Open ASAN-Study_tool -> Subscriptions -> Activate License Key to redeem.`,
  ].join('\n');

  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
    params.recipientEmail
  )}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function buildGmailConfirmationUrl(params: {
  recipientEmail: string;
  subject: string;
  body: string;
}) {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
    params.recipientEmail
  )}&su=${encodeURIComponent(params.subject)}&body=${encodeURIComponent(params.body)}`;
}

function requireWorkspaceToken(): string {
  const token = getAccessToken();
  if (!token) {
    throw new Error(
      'Google Drive is not connected yet. Connect your ASAN-user-content Drive folder first when you want to sync.'
    );
  }
  return token;
}

// --- FOLDER-SCOPED GOOGLE DRIVE (STRICTLY INSIDE ASAN-user-content) ---
export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
  size?: string;
}

const APP_DRIVE_FOLDER_NAME = 'ASAN-user-content';

export async function ensureNamedDriveFolder(
  folderName: string,
  existingFolderId?: string
): Promise<{ id: string; name: string; webViewLink?: string }> {
  const token = requireWorkspaceToken();

  if (existingFolderId) {
    const checkRes = await fetchWithTimeout(
      `https://www.googleapis.com/drive/v3/files/${existingFolderId}?fields=id,name,trashed,webViewLink`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (checkRes.ok) {
      const existing = await safeJson<{ id?: string; trashed?: boolean; name?: string; webViewLink?: string }>(checkRes);
      if (existing?.id && !existing.trashed && existing.name === folderName) {
        return { id: existing.id, name: existing.name, webViewLink: existing.webViewLink };
      }
    }
  }

  const safeName = folderName.replace(/'/g, "\\'");
  const q = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${safeName}' and trashed=false`
  );
  const searchRes = await fetchWithTimeout(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,webViewLink)&pageSize=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (searchRes.ok) {
    const searchData = await safeJson<{ files?: { id: string; name: string; webViewLink?: string }[] }>(searchRes);
    if (searchData.files && searchData.files.length > 0) {
      return searchData.files[0];
    }
  }

  const createRes = await fetchWithTimeout(
    'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    }
  );
  const created = await safeJson<{ id?: string; name?: string; webViewLink?: string; error?: { message?: string } }>(createRes);
  if (!createRes.ok || !created.id) {
    throw new Error(created.error?.message || `Failed to create Drive folder "${folderName}"`);
  }
  return { id: created.id, name: created.name || folderName, webViewLink: created.webViewLink };
}

export async function ensureAppDriveFolder(
  existingFolderId?: string
): Promise<{ id: string; name: string; webViewLink?: string }> {
  return ensureNamedDriveFolder(APP_DRIVE_FOLDER_NAME, existingFolderId);
}

export async function ensureSubfolderInDrive(
  folderName: string,
  parentFolderId: string
): Promise<{ id: string; name: string; webViewLink?: string }> {
  const token = requireWorkspaceToken();
  const safeName = folderName.replace(/'/g, "\\'");
  const q = encodeURIComponent(
    `'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and name='${safeName}' and trashed=false`
  );
  const searchRes = await fetchWithTimeout(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,webViewLink)&pageSize=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (searchRes.ok) {
    const searchData = await safeJson<{ files?: { id: string; name: string; webViewLink?: string }[] }>(searchRes);
    if (searchData.files && searchData.files.length > 0) {
      return searchData.files[0];
    }
  }

  const createRes = await fetchWithTimeout(
    'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId],
      }),
    }
  );
  const created = await safeJson<{ id?: string; name?: string; webViewLink?: string; error?: { message?: string } }>(createRes);
  if (!createRes.ok || !created.id) {
    throw new Error(created.error?.message || `Failed to create subfolder "${folderName}"`);
  }
  return { id: created.id, name: created.name || folderName, webViewLink: created.webViewLink };
}

async function createDriveWorkspaceFile(
  name: string,
  mimeType: string,
  folderId: string
): Promise<{ id: string; name: string; webViewLink?: string }> {
  const token = requireWorkspaceToken();
  const res = await fetchWithTimeout(
    'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        mimeType,
        parents: [folderId],
      }),
    }
  );
  const data = await safeJson<{ id?: string; name?: string; webViewLink?: string; error?: { message?: string } }>(res);
  if (!res.ok || !data.id) {
    throw new Error(data.error?.message || `Failed to create "${name}" inside ASAN-user-content`);
  }
  return { id: data.id, name: data.name || name, webViewLink: data.webViewLink };
}

export async function listDriveFilesInFolder(
  folderId: string
): Promise<DriveFileItem[]> {
  const token = requireWorkspaceToken();
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await fetchWithTimeout(
    `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=50&fields=files(id,name,mimeType,modifiedTime,webViewLink,size)&orderBy=modifiedTime desc`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  const data = await safeJson<{ files?: DriveFileItem[]; error?: { message?: string } }>(res);
  if (!res.ok) {
    throw new Error(
      data.error?.message || 'Failed to list files inside ASAN-user-content folder'
    );
  }
  return data.files || [];
}

export async function uploadFileToDriveFolder(
  file: File,
  folderId: string
): Promise<{ id: string; webViewLink?: string; name: string }> {
  const token = requireWorkspaceToken();
  const metadata = {
    name: file.name,
    mimeType: file.type || 'application/pdf',
    parents: [folderId],
  };

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', file);

  const res = await fetchWithTimeout(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
    60000
  );
  const data = await safeJson<{ id?: string; name?: string; webViewLink?: string; error?: { message?: string } }>(res);
  if (!res.ok || !data.id) {
    throw new Error(data.error?.message || 'Failed to upload file to app folder');
  }
  return { id: data.id, name: data.name || file.name, webViewLink: data.webViewLink };
}

export async function saveTextToDriveFolder(
  fileName: string,
  textContent: string,
  folderId: string
): Promise<{ id: string; webViewLink?: string; name: string }> {
  const token = requireWorkspaceToken();
  const q = encodeURIComponent(
    `'${folderId}' in parents and name='${fileName}' and trashed=false`
  );
  const searchRes = await fetchWithTimeout(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const searchData = searchRes.ok ? await safeJson<{ files?: { id: string }[] }>(searchRes) : { files: [] };
  const existingId = searchData.files?.[0]?.id;

  if (existingId) {
    const updateRes = await fetchWithTimeout(
      `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media&fields=id,name,webViewLink`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'text/plain',
        },
        body: textContent,
      }
    );
    const updated = await safeJson<{ id?: string; name?: string; webViewLink?: string; error?: { message?: string } }>(updateRes);
    if (!updateRes.ok || !updated.id) {
      throw new Error(updated.error?.message || 'Failed to update Drive .txt file');
    }
    return { id: updated.id, name: updated.name || fileName, webViewLink: updated.webViewLink };
  }

  const txtFile = new File([textContent], fileName, { type: 'text/plain' });
  return uploadFileToDriveFolder(txtFile, folderId);
}

export async function saveJsonToDriveFolder(
  fileName: string,
  payload: unknown,
  folderId: string
): Promise<{ id: string; webViewLink?: string; name: string }> {
  const jsonFile = new File(
    [JSON.stringify(payload, null, 2)],
    fileName,
    { type: 'application/json' }
  );
  return uploadFileToDriveFolder(jsonFile, folderId);
}

export async function deleteDriveFile(fileId: string): Promise<void> {
  const token = requireWorkspaceToken();
  const res = await fetchWithTimeout(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = await safeJson<{ error?: { message?: string } }>(res);
    throw new Error(data.error?.message || 'Failed to delete Drive file');
  }
}

// --- GOOGLE DOCS (Created strictly inside ASAN-user-content) ---
export async function exportNoteToGoogleDoc(
  title: string,
  plainTextBody: string,
  folderId?: string
): Promise<{ documentId: string; url: string }> {
  const token = requireWorkspaceToken();
  const targetFolderId = folderId || (await ensureAppDriveFolder()).id;
  const createdDoc = await createDriveWorkspaceFile(
    title,
    'application/vnd.google-apps.document',
    targetFolderId
  );

  const documentId = createdDoc.id;
  if (plainTextBody.trim().length > 0) {
    const updateRes = await fetchWithTimeout(
      `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              insertText: {
                location: { index: 1 },
                text: plainTextBody,
              },
            },
          ],
        }),
      }
    );
    if (!updateRes.ok) {
      const errData = await safeJson<{ error?: { message?: string } }>(updateRes);
      throw new Error(errData.error?.message || 'Created Doc inside ASAN-user-content but failed to insert text');
    }
  }

  return {
    documentId,
    url: createdDoc.webViewLink || `https://docs.google.com/document/d/${documentId}/edit`,
  };
}

// --- GOOGLE SHEETS (Tasks Export & Schedule Sync — strictly inside ASAN-user-content) ---
export async function exportRowsToGoogleSheet(
  title: string,
  headers: string[],
  rows: (string | number)[][],
  folderId?: string
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const token = requireWorkspaceToken();
  const targetFolderId = folderId || (await ensureAppDriveFolder()).id;
  const createdFile = await createDriveWorkspaceFile(
    title,
    'application/vnd.google-apps.spreadsheet',
    targetFolderId
  );

  const spreadsheetId = createdFile.id;
  const metaRes = await fetchWithTimeout(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetUrl,sheets.properties.title`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const sheetData = metaRes.ok
    ? await safeJson<{ spreadsheetUrl?: string; sheets?: { properties?: { title?: string } }[] }>(metaRes)
    : {};
  const firstSheetTitle = sheetData.sheets?.[0]?.properties?.title || 'Sheet1';
  const values = [headers, ...rows];

  const writeRes = await fetchWithTimeout(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      `${firstSheetTitle}!A1`
    )}:append?valueInputOption=USER_ENTERED`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    }
  );
  if (!writeRes.ok) {
    const errData = await safeJson<{ error?: { message?: string } }>(writeRes);
    throw new Error(errData.error?.message || 'Created spreadsheet inside ASAN-user-content but failed to write rows');
  }

  return {
    spreadsheetId,
    spreadsheetUrl:
      sheetData.spreadsheetUrl ||
      createdFile.webViewLink ||
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
}

export async function syncScheduleToGoogleSheet(
  existingSheetId: string,
  scheduleRows: (string | number)[][],
  folderId?: string
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const token = requireWorkspaceToken();
  const targetFolderId = folderId || (await ensureAppDriveFolder()).id;
  const headers = [
    'Date (YYYY-MM-DD)',
    'Time (HH:MM)',
    'Category',
    'Title / Subject',
    'Details / Duration',
    'Meet Link',
  ];

  let spreadsheetId = existingSheetId;
  let sheetTitle = 'Schedule';
  let spreadsheetUrl = spreadsheetId
    ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
    : '';

  if (spreadsheetId) {
    const checkDriveRes = await fetchWithTimeout(
      `https://www.googleapis.com/drive/v3/files/${spreadsheetId}?fields=id,trashed,parents`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const driveMeta = checkDriveRes.ok
      ? await safeJson<{ trashed?: boolean; parents?: string[] }>(checkDriveRes)
      : null;
    const inAppFolder =
      driveMeta &&
      !driveMeta.trashed &&
      Array.isArray(driveMeta.parents) &&
      driveMeta.parents.includes(targetFolderId);

    if (inAppFolder) {
      const metaRes = await fetchWithTimeout(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetUrl,sheets.properties.title`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (metaRes.ok) {
        const meta = await safeJson<{ spreadsheetUrl?: string; sheets?: { properties?: { title?: string } }[] }>(metaRes);
        spreadsheetUrl = meta.spreadsheetUrl || spreadsheetUrl;
        sheetTitle = meta.sheets?.[0]?.properties?.title || 'Schedule';
      } else {
        spreadsheetId = '';
      }
    } else {
      spreadsheetId = '';
    }
  }

  if (!spreadsheetId) {
    const createdFile = await createDriveWorkspaceFile(
      'ASAN-user-content Schedule',
      'application/vnd.google-apps.spreadsheet',
      targetFolderId
    );
    spreadsheetId = createdFile.id;
    spreadsheetUrl =
      createdFile.webViewLink ||
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    const metaRes = await fetchWithTimeout(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetUrl,sheets(properties(sheetId,title))`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (metaRes.ok) {
      const meta = await safeJson<{
        spreadsheetUrl?: string;
        sheets?: { properties?: { sheetId?: number; title?: string } }[];
      }>(metaRes);
      spreadsheetUrl = meta.spreadsheetUrl || spreadsheetUrl;
      const firstProps = meta.sheets?.[0]?.properties;
      if (firstProps && firstProps.title !== 'Schedule') {
        await fetchWithTimeout(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              requests: [
                {
                  updateSheetProperties: {
                    properties: { sheetId: firstProps.sheetId, title: 'Schedule' },
                    fields: 'title',
                  },
                },
              ],
            }),
          }
        ).catch(() => {});
      }
    }
    sheetTitle = 'Schedule';
  }

  await fetchWithTimeout(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      `${sheetTitle}!A1:F500`
    )}:clear`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  const writeRes = await fetchWithTimeout(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      `${sheetTitle}!A1`
    )}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [headers, ...scheduleRows] }),
    }
  );
  if (!writeRes.ok) {
    const err = await safeJson<{ error?: { message?: string } }>(writeRes);
    throw new Error(err.error?.message || 'Failed to sync schedule rows to Sheet');
  }

  return { spreadsheetId, spreadsheetUrl };
}

export async function pullScheduleFromGoogleSheet(
  spreadsheetId: string
): Promise<
  {
    eventDate: string;
    eventTime: string;
    category: string;
    title: string;
    notes: string;
    meetLink: string;
  }[]
> {
  const token = requireWorkspaceToken();
  const metaRes = await fetchWithTimeout(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const meta = await safeJson<{ sheets?: { properties?: { title?: string } }[]; error?: { message?: string } }>(metaRes);
  if (!metaRes.ok) {
    throw new Error(meta.error?.message || 'Could not access Schedule Sheet');
  }
  const sheetTitle = meta.sheets?.[0]?.properties?.title || 'Schedule';

  const valRes = await fetchWithTimeout(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      `${sheetTitle}!A2:F500`
    )}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const valData = await safeJson<{ values?: string[][]; error?: { message?: string } }>(valRes);
  if (!valRes.ok) {
    throw new Error(valData.error?.message || 'Failed to read rows from Schedule Sheet');
  }

  const rows: string[][] = valData.values || [];
  return rows
    .filter((r) => r[0] && r[3])
    .map((r) => ({
      eventDate: String(r[0]).trim(),
      eventTime: String(r[1] || '09:00').trim(),
      category: String(r[2] || 'study').trim().toLowerCase(),
      title: String(r[3]).trim(),
      notes: String(r[4] || '').trim(),
      meetLink: String(r[5] || '').trim(),
    }));
}

// --- GOOGLE SHEETS MASTER EXAM BLUEPRINT ("master" -> "test_dates" inside ASAN-user-content) ---
// Exact 3-row x 4-column layout per card:
// Row 1: [Marks Scored (opt), Syllabus[], Subject, Question Paper]
// Row 2: [Total Marks, Date, Paper Code, Answer Sheet]
// Row 3: [Percentage, Time, Type, Corrected Answer Sheet]
export async function syncMasterExamSheet(
  cards: ExamBlueprintItem[],
  folderId?: string
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const token = requireWorkspaceToken();
  const targetFolderId = folderId || (await ensureAppDriveFolder()).id;

  const q = encodeURIComponent(
    `'${targetFolderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and name='master' and trashed=false`
  );
  const searchRes = await fetchWithTimeout(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,webViewLink)&pageSize=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const searchData = searchRes.ok
    ? await safeJson<{ files?: { id: string }[] }>(searchRes)
    : { files: [] };
  let spreadsheetId = searchData.files?.[0]?.id;
  let spreadsheetUrl = spreadsheetId
    ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
    : '';

  if (!spreadsheetId) {
    const createdFile = await createDriveWorkspaceFile(
      'master',
      'application/vnd.google-apps.spreadsheet',
      targetFolderId
    );
    spreadsheetId = createdFile.id;
    spreadsheetUrl =
      createdFile.webViewLink ||
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    const metaRes = await fetchWithTimeout(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetUrl,sheets(properties(sheetId,title))`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (metaRes.ok) {
      const meta = await safeJson<{
        spreadsheetUrl?: string;
        sheets?: { properties?: { sheetId?: number; title?: string } }[];
      }>(metaRes);
      spreadsheetUrl = meta.spreadsheetUrl || spreadsheetUrl;
      const firstProps = meta.sheets?.[0]?.properties;
      if (firstProps && firstProps.title !== 'test_dates') {
        await fetchWithTimeout(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              requests: [
                {
                  updateSheetProperties: {
                    properties: { sheetId: firstProps.sheetId, title: 'test_dates' },
                    fields: 'title',
                  },
                },
              ],
            }),
          }
        ).catch(() => {});
      }
    }
  } else {
    const metaRes = await fetchWithTimeout(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetUrl,sheets.properties.title`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const meta = await safeJson<{
      spreadsheetUrl?: string;
      sheets?: { properties?: { title?: string } }[];
    }>(metaRes);
    if (metaRes.ok) {
      spreadsheetUrl = meta.spreadsheetUrl || spreadsheetUrl;
      const hasTab = (meta.sheets || []).some(
        (s) => s.properties?.title === 'test_dates'
      );
      if (!hasTab) {
        await fetchWithTimeout(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              requests: [{ addSheet: { properties: { title: 'test_dates' } } }],
            }),
          }
        );
      }
    }
  }

  await fetchWithTimeout(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      'test_dates!A1:D600'
    )}:clear`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  const values: (string | number)[][] = [];
  for (const c of cards) {
    const pct =
      c.marksScored !== null && c.marksScored !== undefined && c.totalMarks > 0
        ? `${((c.marksScored / c.totalMarks) * 100).toFixed(1)}%`
        : c.percentage || '';
    values.push([
      c.marksScored !== null && c.marksScored !== undefined ? c.marksScored : '',
      c.syllabus.join(', '),
      c.subject,
      c.questionPaperUrl || '',
    ]);
    values.push([c.totalMarks, c.examDate, c.paperCode, c.answerSheetUrl || '']);
    values.push([pct, c.examTime, c.examType, c.correctedAnswerSheetUrl || '']);
  }

  if (values.length > 0) {
    const writeRes = await fetchWithTimeout(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
        'test_dates!A1'
      )}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values }),
      }
    );
    if (!writeRes.ok) {
      const err = await safeJson<{ error?: { message?: string } }>(writeRes);
      throw new Error(err.error?.message || 'Failed to write rows to master -> test_dates');
    }
  }

  return { spreadsheetId: spreadsheetId!, spreadsheetUrl };
}

export async function pullMasterExamSheet(folderId?: string): Promise<
  Omit<ExamBlueprintItem, 'id' | 'userId' | 'createdAt' | 'updatedAt'>[]
> {
  const token = requireWorkspaceToken();
  const targetFolderId = folderId || (await ensureAppDriveFolder()).id;
  const q = encodeURIComponent(
    `'${targetFolderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and name='master' and trashed=false`
  );
  const searchRes = await fetchWithTimeout(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const searchData = searchRes.ok
    ? await safeJson<{ files?: { id: string }[] }>(searchRes)
    : { files: [] };
  const spreadsheetId = searchData.files?.[0]?.id;
  if (!spreadsheetId) {
    throw new Error('Google Sheet named "master" not found inside ASAN-user-content. Sync cards first to create it.');
  }

  const valRes = await fetchWithTimeout(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      'test_dates!A1:D600'
    )}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const valData = await safeJson<{ values?: string[][]; error?: { message?: string } }>(valRes);
  if (!valRes.ok) {
    throw new Error(valData.error?.message || 'Could not read "test_dates" sheet inside "master"');
  }

  const rawRows: string[][] = valData.values || [];
  const cleanRows = rawRows.filter((r) => r.some((cell) => String(cell || '').trim() !== ''));
  const cards: Omit<ExamBlueprintItem, 'id' | 'userId' | 'createdAt' | 'updatedAt'>[] = [];

  for (let i = 0; i + 2 < cleanRows.length; i += 3) {
    const r1 = cleanRows[i];
    const r2 = cleanRows[i + 1];
    const r3 = cleanRows[i + 2];
    const marksRaw = String(r1[0] || '').trim();
    const totalRaw = Number(r2[0] || 100);
    const totalMarks = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : 100;
    const marksScored = marksRaw !== '' && Number.isFinite(Number(marksRaw)) ? Number(marksRaw) : null;
    const subject = String(r1[2] || '').trim();
    const paperCode = String(r2[2] || '').trim().toUpperCase();
    const examDate = String(r2[1] || '').trim();
    if (!subject || !examDate) continue;

    cards.push({
      paperCode,
      subject,
      examType: String(r3[2] || 'JEE Main').trim(),
      examDate,
      examTime: String(r3[1] || '09:00').trim(),
      totalMarks,
      marksScored,
      percentage:
        marksScored !== null
          ? `${((marksScored / totalMarks) * 100).toFixed(1)}%`
          : String(r3[0] || '').trim(),
      syllabus: String(r1[1] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      questionPaperUrl: String(r1[3] || '').trim(),
      answerSheetUrl: String(r2[3] || '').trim(),
      correctedAnswerSheetUrl: String(r3[3] || '').trim(),
    });
  }

  return cards;
}

// --- GOOGLE MEET ---
export async function createGoogleMeetRoom(): Promise<{
  meetingUri: string;
  meetingCode: string;
  name: string;
}> {
  const token = requireWorkspaceToken();
  const res = await fetchWithTimeout('https://meet.googleapis.com/v2/spaces', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  const data = await safeJson<{
    meetingUri?: string;
    meetingCode?: string;
    name?: string;
    error?: { message?: string };
  }>(res);
  if (!res.ok || !data.meetingUri) {
    throw new Error(data.error?.message || 'Failed to create Google Meet study room');
  }
  return {
    meetingUri: data.meetingUri,
    meetingCode: data.meetingCode || '',
    name: data.name || '',
  };
}
