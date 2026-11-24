import crypto from 'crypto';
import type { GA4ReportResponse } from '../types.ts';

interface ServiceAccountCreds {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
  cacheKey: string;
}

interface CachedReport {
  data: GA4ReportResponse;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;
const reportCache = new Map<string, CachedReport>();

function cleanEnvValue(raw?: string): string {
  const s = (raw || '').trim();
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    return s.slice(1, -1).trim();
  }
  return s;
}

export function getPublicMeasurementId(): string {
  return (
    cleanEnvValue(process.env.GA4_MEASUREMENT_ID) ||
    cleanEnvValue(process.env.VITE_GA_MEASUREMENT_ID) ||
    ''
  );
}

function parseServiceAccountJson(raw: string): ServiceAccountCreds | null {
  const trimmed = cleanEnvValue(raw);
  if (!trimmed) return null;
  const attempts: string[] = [trimmed];
  if (!trimmed.startsWith('{')) {
    try {
      attempts.push(Buffer.from(trimmed, 'base64').toString('utf8'));
    } catch {
      // ignore base64 decode failure
    }
  }
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate) as Partial<ServiceAccountCreds>;
      if (parsed.client_email && parsed.private_key) {
        return {
          client_email: parsed.client_email.trim(),
          private_key: parsed.private_key.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n'),
          token_uri: parsed.token_uri || 'https://oauth2.googleapis.com/token',
        };
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function getGa4AccessToken(creds: ServiceAccountCreds): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const cacheKey = creds.client_email;
  if (
    cachedToken &&
    cachedToken.cacheKey === cacheKey &&
    Date.now() < cachedToken.expiresAt - 60_000
  ) {
    return cachedToken.accessToken;
  }

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const tokenUri = creds.token_uri || 'https://oauth2.googleapis.com/token';
  const claimSet = Buffer.from(
    JSON.stringify({
      iss: creds.client_email,
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
      aud: tokenUri,
      iat: nowSec,
      exp: nowSec + 3600,
    })
  ).toString('base64url');

  const unsignedJwt = `${header}.${claimSet}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedJwt);
  signer.end();
  const signature = signer.sign(creds.private_key, 'base64url');
  const assertion = `${unsignedJwt}.${signature}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !data.access_token) {
      throw new Error(
        data.error_description || data.error || `Google OAuth token exchange failed (${res.status})`
      );
    }
    cachedToken = {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
      cacheKey,
    };
    return data.access_token;
  } finally {
    clearTimeout(timer);
  }
}

interface Ga4Row {
  dimensionValues?: { value?: string }[];
  metricValues?: { value?: string }[];
}

interface Ga4RunReportResult {
  rows?: Ga4Row[];
}

async function runGa4Endpoint(
  url: string,
  accessToken: string,
  body: Record<string, unknown>
): Promise<Ga4RunReportResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => ({}))) as Ga4RunReportResult & {
      error?: { message?: string; status?: string };
    };
    if (!res.ok) {
      throw new Error(
        data.error?.message || `GA4 API error (${res.status})`
      );
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function emptyReport(
  range: '7d' | '28d' | '90d',
  reason: string,
  propertyId?: string
): GA4ReportResponse {
  const measurementId = getPublicMeasurementId();
  return {
    configured: false,
    trackingConfigured: Boolean(measurementId),
    measurementId,
    propertyId,
    range,
    fetchedAt: new Date().toISOString(),
    reason,
    realtimeActiveUsers: 0,
    overview: {
      activeUsers: 0,
      newUsers: 0,
      sessions: 0,
      engagedSessions: 0,
      pageViews: 0,
      engagementRate: 0,
      avgSessionDurationSec: 0,
    },
    daily: [],
    topPages: [],
    devices: [],
    countries: [],
  };
}

function formatGa4Date(raw: string): string {
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw;
}

export async function fetchGa4Report(
  rawRange: string,
  forceRefresh = false
): Promise<GA4ReportResponse> {
  const range: '7d' | '28d' | '90d' =
    rawRange === '7d' || rawRange === '90d' ? rawRange : '28d';

  const rawProp = cleanEnvValue(process.env.GA4_PROPERTY_ID);
  const propertyId = rawProp.replace(/^properties\//i, '').trim();
  const rawServiceAccount = (process.env.GA4_SERVICE_ACCOUNT_JSON || '').trim();
  const measurementId = getPublicMeasurementId();

  if (!propertyId) {
    return emptyReport(
      range,
      'GA4_PROPERTY_ID is not set in server environment variables.'
    );
  }
  if (!/^\d+$/.test(propertyId)) {
    return emptyReport(
      range,
      'GA4_PROPERTY_ID must be the numeric Property ID (digits only, from GA4 Admin -> Property Settings).',
      propertyId
    );
  }
  if (!rawServiceAccount) {
    return emptyReport(
      range,
      'GA4_SERVICE_ACCOUNT_JSON is not set in server environment variables.',
      propertyId
    );
  }

  const creds = parseServiceAccountJson(rawServiceAccount);
  if (!creds) {
    return emptyReport(
      range,
      'GA4_SERVICE_ACCOUNT_JSON could not be parsed as valid Google Service Account JSON.',
      propertyId
    );
  }

  const cacheKey = `${propertyId}:${range}`;
  const existing = reportCache.get(cacheKey);
  if (!forceRefresh && existing && Date.now() < existing.expiresAt) {
    return { ...existing.data, cached: true };
  }

  const startDate = range === '7d' ? '7daysAgo' : range === '90d' ? '90daysAgo' : '28daysAgo';
  const baseEndpoint = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}`;

  try {
    const accessToken = await getGa4AccessToken(creds);

    const [overviewRes, dailyRes, pagesRes, devicesRes, countriesRes, realtimeRes] =
      await Promise.all([
        runGa4Endpoint(`${baseEndpoint}:runReport`, accessToken, {
          dateRanges: [{ startDate, endDate: 'today' }],
          metrics: [
            { name: 'activeUsers' },
            { name: 'newUsers' },
            { name: 'sessions' },
            { name: 'engagedSessions' },
            { name: 'screenPageViews' },
            { name: 'engagementRate' },
            { name: 'averageSessionDuration' },
          ],
        }),
        runGa4Endpoint(`${baseEndpoint}:runReport`, accessToken, {
          dateRanges: [{ startDate, endDate: 'today' }],
          dimensions: [{ name: 'date' }],
          metrics: [
            { name: 'activeUsers' },
            { name: 'sessions' },
            { name: 'screenPageViews' },
          ],
          orderBys: [{ dimension: { dimensionName: 'date' } }],
        }),
        runGa4Endpoint(`${baseEndpoint}:runReport`, accessToken, {
          dateRanges: [{ startDate, endDate: 'today' }],
          dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
          metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
          orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
          limit: 10,
        }),
        runGa4Endpoint(`${baseEndpoint}:runReport`, accessToken, {
          dateRanges: [{ startDate, endDate: 'today' }],
          dimensions: [{ name: 'deviceCategory' }],
          metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
          orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
          limit: 6,
        }),
        runGa4Endpoint(`${baseEndpoint}:runReport`, accessToken, {
          dateRanges: [{ startDate, endDate: 'today' }],
          dimensions: [{ name: 'country' }],
          metrics: [{ name: 'activeUsers' }],
          orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
          limit: 8,
        }),
        runGa4Endpoint(`${baseEndpoint}:runRealtimeReport`, accessToken, {
          metrics: [{ name: 'activeUsers' }],
        }).catch(() => ({ rows: [] }) as Ga4RunReportResult),
      ]);

    const ovMetrics = overviewRes.rows?.[0]?.metricValues || [];
    const num = (i: number) => Number(ovMetrics[i]?.value || 0) || 0;

    const report: GA4ReportResponse = {
      configured: true,
      trackingConfigured: Boolean(measurementId),
      measurementId,
      propertyId,
      range,
      fetchedAt: new Date().toISOString(),
      cached: false,
      realtimeActiveUsers: Number(realtimeRes.rows?.[0]?.metricValues?.[0]?.value || 0) || 0,
      overview: {
        activeUsers: Math.round(num(0)),
        newUsers: Math.round(num(1)),
        sessions: Math.round(num(2)),
        engagedSessions: Math.round(num(3)),
        pageViews: Math.round(num(4)),
        engagementRate: Math.round(num(5) * 1000) / 10,
        avgSessionDurationSec: Math.round(num(6)),
      },
      daily: (dailyRes.rows || []).map((r) => ({
        date: formatGa4Date(r.dimensionValues?.[0]?.value || ''),
        activeUsers: Math.round(Number(r.metricValues?.[0]?.value || 0)),
        sessions: Math.round(Number(r.metricValues?.[1]?.value || 0)),
        pageViews: Math.round(Number(r.metricValues?.[2]?.value || 0)),
      })),
      topPages: (pagesRes.rows || []).map((r) => ({
        path: r.dimensionValues?.[0]?.value || '/',
        title: r.dimensionValues?.[1]?.value || 'Page',
        pageViews: Math.round(Number(r.metricValues?.[0]?.value || 0)),
        activeUsers: Math.round(Number(r.metricValues?.[1]?.value || 0)),
      })),
      devices: (devicesRes.rows || []).map((r) => ({
        device: r.dimensionValues?.[0]?.value || 'unknown',
        activeUsers: Math.round(Number(r.metricValues?.[0]?.value || 0)),
        sessions: Math.round(Number(r.metricValues?.[1]?.value || 0)),
      })),
      countries: (countriesRes.rows || []).map((r) => ({
        country: r.dimensionValues?.[0]?.value || 'Unknown',
        activeUsers: Math.round(Number(r.metricValues?.[0]?.value || 0)),
      })),
    };

    reportCache.set(cacheKey, {
      data: report,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    return report;
  } catch (err) {
    const rawMsg =
      err instanceof Error ? err.message : 'Unable to query Google Analytics Data API.';
    const message = /permission|403|disabled|not been used/i.test(rawMsg)
      ? `${rawMsg} — Verify Google Analytics Data API is enabled in GCP and "${creds.client_email}" has Viewer access in GA4 Property Access Management.`
      : rawMsg;
    return emptyReport(range, message, propertyId);
  }
}
